// src/app/api/receipts/send/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import sgMail from '@sendgrid/mail'

// Initialize SendGrid with error handling
if (!process.env.SENDGRID_API_KEY) {
  logger.error("SENDGRID_API_KEY environment variable is not set")
  throw new Error("SendGrid API key is required")
}
sgMail.setApiKey(process.env.SENDGRID_API_KEY)

// ✅ FIXED: Added proper TypeScript interfaces
interface SendReceiptRequest {
  organization_id: string;
  donor_email: string;
  amount: number;
  transaction_id?: string;
  order_id?: string;
  payment_date?: string;
  organization_name?: string;
  organization_tax_id?: string;
  organization_receipt_message?: string;
}

interface OrganizationSettings {
  id: string;
  name: string;
  tax_id: string;
  receipt_message?: string;
  logo_url?: string;
  contact_email?: string;
  website?: string;
  receipt_enabled: boolean;
}

interface ReceiptData {
  organization: {
    name: string;
    taxId: string;
    message: string;
    logoUrl?: string;
    contactEmail?: string;
    website?: string;
  };
  donation: {
    amount: number;
    formattedAmount: string;
    transactionId: string;
    orderId?: string;
    date: string;
    year: number;
  };
  donor: {
    email: string;
  };
}

interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

interface RateLimitResult {
  allowed: boolean;
  resetTime: number;
}

// Rate limiting map (in production, use Redis)
const rateLimitMap = new Map<string, { count: number; resetTime: number }>()
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute
const RATE_LIMIT_MAX = 10 // Max 10 emails per minute per org

export async function POST(request: NextRequest) {
  const db = createClient()
  let receiptLogId: number | null = null

  try {
    // Parse and validate request body
    let body: SendReceiptRequest
    try {
      body = await request.json()
    } catch (parseError) {
      logger.error("Invalid JSON in receipt request", { error: parseError })
      return NextResponse.json({ error: "Invalid JSON format" }, { status: 400 })
    }

    const { 
      organization_id, 
      donor_email, 
      amount, 
      transaction_id, 
      order_id,
      payment_date 
    } = body

    // Comprehensive input validation
    const validation = validateReceiptRequest(body)
    if (!validation.valid) {
      logger.error("Receipt request validation failed", { 
        organization_id, 
        donor_email, 
        errors: validation.errors 
      })
      return NextResponse.json({ 
        error: "Validation failed", 
        details: validation.errors 
      }, { status: 400 })
    }

    // Rate limiting check
    const rateLimitResult = checkRateLimit(organization_id)
    if (!rateLimitResult.allowed) {
      logger.warn("Rate limit exceeded for receipt sending", { 
        organization_id, 
        remaining_time: rateLimitResult.resetTime - Date.now() 
      })
      return NextResponse.json({ 
        error: "Rate limit exceeded. Please try again later.",
        retry_after: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
      }, { status: 429 })
    }

// Get organization settings with better error handling
const orgSettings = await getOrganizationSettings(db, organization_id, {
  organization_name: body.organization_name,
  organization_tax_id: body.organization_tax_id, 
  organization_receipt_message: body.organization_receipt_message
})

// ✅ FIX: Add null check here
if (!orgSettings) {
  logger.error("Organization not found or not configured", { organization_id })
  return NextResponse.json({ error: "Organization not found or not properly configured" }, { status: 404 })
}

if (!orgSettings.receipt_enabled) {
  logger.warn("Receipt sending disabled for organization", { organization_id })
  return NextResponse.json({ error: "Receipt sending is disabled for this organization" }, { status: 403 })
}

// Create receipt log entry (for tracking)
receiptLogId = await createReceiptLogEntry(db, {
  organization_id,
  donor_email,
  amount,
  transaction_id,
  order_id
})

// Generate receipt content - now TypeScript knows orgSettings is not null
const receiptData = generateReceiptData(orgSettings, {
  amount,
  transaction_id,
  order_id,
  payment_date,
  donor_email
})

// Send email with retry logic - now TypeScript knows orgSettings is not null
const emailResult = await sendReceiptEmail(receiptData, orgSettings)
    
    if (emailResult.success) {
      // Update receipt log with success
      await updateReceiptLogSuccess(db, receiptLogId, emailResult.messageId!)
      
      logger.info("Receipt sent successfully", { 
        organization_id, 
        donor_email, 
        amount, 
        transaction_id,
        message_id: emailResult.messageId,
        receipt_log_id: receiptLogId
      })

      return NextResponse.json({ 
        success: true, 
        message: "Receipt sent successfully",
        receipt_id: receiptLogId
      })
    } else {
      // Update receipt log with failure
      await updateReceiptLogFailure(db, receiptLogId, emailResult.error!)
      
      logger.error("Failed to send receipt", { 
        organization_id, 
        donor_email, 
        error: emailResult.error,
        receipt_log_id: receiptLogId
      })

      return NextResponse.json({ 
        error: "Failed to send receipt",
        details: emailResult.error,
        receipt_id: receiptLogId
      }, { status: 500 })
    }

  } catch (error: any) {
    logger.error("Unexpected error in receipt sending", { 
      error: error.message, 
      stack: error.stack,
      receipt_log_id: receiptLogId
    })

    // Update receipt log with failure if we have an ID
    if (receiptLogId) {
      try {
        await updateReceiptLogFailure(db, receiptLogId, error.message)
      } catch (updateError) {
        logger.error("Failed to update receipt log with error", { 
          updateError, 
          receipt_log_id: receiptLogId 
        })
      }
    }

    return NextResponse.json({ 
      error: "Internal server error",
      receipt_id: receiptLogId
    }, { status: 500 })
  } finally {
    try {
      await db.end()
    } catch (dbCloseError) {
      logger.warn("Error closing database connection", { error: dbCloseError })
    }
  }
}

// ✅ FIXED: Added explicit return type
function validateReceiptRequest(body: SendReceiptRequest): ValidationResult {
  const errors: string[] = []

  if (!body.organization_id || typeof body.organization_id !== 'string') {
    errors.push("organization_id is required and must be a string")
  }

  if (!body.donor_email || typeof body.donor_email !== 'string') {
    errors.push("donor_email is required and must be a string")
  } else {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(body.donor_email)) {
      errors.push("donor_email must be a valid email address")
    }
  }

  if (!body.amount || typeof body.amount !== 'number' || body.amount <= 0) {
    errors.push("amount is required and must be a positive number")
  }

  // Validate amount is reasonable (not too large)
  if (body.amount && body.amount > 1000000) {
    errors.push("amount exceeds maximum allowed value")
  }

  return { valid: errors.length === 0, errors }
}

// ✅ FIXED: Added explicit return type
function checkRateLimit(organizationId: string): RateLimitResult {
  const now = Date.now()
  const key = `receipt_${organizationId}`
  const existing = rateLimitMap.get(key)

  if (!existing || now > existing.resetTime) {
    // Reset or create new entry
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return { allowed: true, resetTime: now + RATE_LIMIT_WINDOW }
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return { allowed: false, resetTime: existing.resetTime }
  }

  // Increment count
  existing.count++
  rateLimitMap.set(key, existing)
  return { allowed: true, resetTime: existing.resetTime }
}

// ✅ COMPLETELY REPLACED: Use settings from iOS app instead of database
// Replace the getOrganizationSettings function in route.ts with this:

async function getOrganizationSettings(
  db: any, 
  organizationId: string, 
  providedSettings?: {
    organization_name?: string;
    organization_tax_id?: string;
    organization_receipt_message?: string;
  }
): Promise<OrganizationSettings | null> {
  try {
    // 🎯 WHITE-LABEL SOLUTION: REQUIRE organization settings from iOS app
    console.log("📧 Checking provided settings:", providedSettings)
    
    // ✅ Organization settings MUST be provided for white-label app
    if (!providedSettings || !providedSettings.organization_name) {
      console.log("❌ No organization settings provided - this is required for white-label")
      logger.error("Organization settings not provided in request", { organizationId, providedSettings })
      return null
    }

    console.log("✅ Using provided organization settings:", providedSettings)
    
    return {
      id: organizationId,
      name: providedSettings.organization_name,
      tax_id: providedSettings.organization_tax_id || "",
      receipt_message: providedSettings.organization_receipt_message || "Thank you for your generous donation!",
      logo_url: undefined,
      contact_email: undefined,
      website: undefined,
      receipt_enabled: true
    }
    
  } catch (error) {
    logger.error("Error processing organization settings", { error, organizationId })
    return null
  }
}

// ✅ FIXED: Added proper error handling with try/catch
async function createReceiptLogEntry(db: any, data: {
  organization_id: string;
  donor_email: string;
  amount: number;
  transaction_id?: string;
  order_id?: string;
}): Promise<number> {
  try {
    const result = await db.query(
      `INSERT INTO receipt_log (
        organization_id, 
        donor_email, 
        amount, 
        transaction_id, 
        order_id,
        delivery_status,
        requested_at
      ) VALUES ($1, $2, $3, $4, $5, 'pending', NOW())
      RETURNING id`,
      [data.organization_id, data.donor_email, data.amount, data.transaction_id, data.order_id]
    )
    
    return result.rows[0].id
  } catch (error) {
    logger.error("Database error creating receipt log entry", { error, data })
    throw error
  }
}

// ✅ FIXED: Added proper error handling with try/catch
async function updateReceiptLogSuccess(db: any, receiptLogId: number, messageId: string): Promise<void> {
  try {
    await db.query(
      `UPDATE receipt_log 
       SET delivery_status = 'sent', 
           sent_at = NOW(), 
           sendgrid_message_id = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [messageId, receiptLogId]
    )
  } catch (error) {
    logger.error("Database error updating receipt log success", { error, receiptLogId, messageId })
    throw error
  }
}

// ✅ FIXED: Added proper error handling with try/catch
async function updateReceiptLogFailure(db: any, receiptLogId: number, error: string): Promise<void> {
  try {
    await db.query(
      `UPDATE receipt_log 
       SET delivery_status = 'failed', 
           delivery_error = $1,
           retry_count = retry_count + 1,
           last_retry_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [error, receiptLogId]
    )
  } catch (dbError) {
    logger.error("Database error updating receipt log failure", { error: dbError, receiptLogId, originalError: error })
    throw dbError
  }
}

// ✅ FIXED: Added proper typing and return type
function generateReceiptData(orgSettings: OrganizationSettings, donationData: any): ReceiptData {
  return {
    organization: {
      name: orgSettings.name,
      taxId: orgSettings.tax_id,
      message: orgSettings.receipt_message || "Thank you for your generous donation!",
      logoUrl: orgSettings.logo_url,
      contactEmail: orgSettings.contact_email,
      website: orgSettings.website
    },
    donation: {
      amount: donationData.amount,
      formattedAmount: `$${donationData.amount.toFixed(2)}`,
      transactionId: donationData.transaction_id || `TXN-${Date.now()}`,
      orderId: donationData.order_id,
      date: donationData.payment_date || new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      year: new Date().getFullYear()
    },
    donor: {
      email: donationData.donor_email
    }
  }
}

// ✅ FIXED: Added proper return type
async function sendReceiptEmail(receiptData: ReceiptData, orgSettings: OrganizationSettings): Promise<EmailResult> {
  try {
    const htmlContent = generateReceiptHTML(receiptData)
    const textContent = generateReceiptText(receiptData) // ✅ This function is now defined below

    const msg = {
      to: receiptData.donor.email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'noreply@shulpad.com',
        name: `${orgSettings.name} via ShulPad`
      },
      subject: `Donation Receipt - ${orgSettings.name}`,
      text: textContent,
      html: htmlContent,
      categories: ['donation-receipt'],
      customArgs: {
        organization_id: orgSettings.id,
        transaction_id: receiptData.donation.transactionId,
        amount: receiptData.donation.amount.toString()
      },
      // Add tracking
      trackingSettings: {
        clickTracking: { enable: false },
        openTracking: { enable: true },
        subscriptionTracking: { enable: false }
      }
    }

    const response = await sgMail.send(msg)
    const messageId = response[0].headers['x-message-id']
    
    return { success: true, messageId }
  } catch (sendGridError: any) {
    let errorMessage = "Unknown SendGrid error"
    
    if (sendGridError.response) {
      errorMessage = `SendGrid API error: ${sendGridError.response.body?.errors?.[0]?.message || sendGridError.message}`
    } else {
      errorMessage = sendGridError.message || "SendGrid service error"
    }
    
    return { success: false, error: errorMessage }
  }
}

// ✅ FIXED: Added explicit return type
// Replace the existing generateReceiptHTML function in your route.ts file with this:

function generateReceiptHTML(data: ReceiptData): string {
  // Escape HTML to prevent XSS (server-side safe version)
  const escapeHtml = (text: string): string => {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;")
  }

  const safeOrgName = escapeHtml(data.organization.name)
  const safeMessage = escapeHtml(data.organization.message)
  const safeTaxId = escapeHtml(data.organization.taxId)
  const safeTransactionId = escapeHtml(data.donation.transactionId)
  const safeOrderId = data.donation.orderId ? escapeHtml(data.donation.orderId) : null

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Thank You for Your Donation</title>
      <style>
        * { box-sizing: border-box; }
        
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
          line-height: 1.6;
          margin: 0;
          padding: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
        }
        
        .email-wrapper {
          max-width: 600px;
          margin: 0 auto;
          padding: 40px 20px;
        }
        
        .email-container {
          background: #ffffff;
          border-radius: 24px;
          overflow: hidden;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
        }
        
        .header {
          background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
          padding: 50px 40px;
          text-align: center;
          color: white;
          position: relative;
        }
        
        .header::after {
          content: '';
          position: absolute;
          bottom: -20px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 20px solid transparent;
          border-right: 20px solid transparent;
          border-top: 20px solid #00f2fe;
        }
        
        .heart-icon {
          background: rgba(255, 255, 255, 0.2);
          width: 80px;
          height: 80px;
          border-radius: 50%;
          margin: 0 auto 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 36px;
        }
        
        .org-name {
          font-size: 28px;
          font-weight: 700;
          margin: 0 0 10px 0;
          text-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .thank-you {
          font-size: 18px;
          margin: 0;
          opacity: 0.95;
          font-weight: 300;
        }
        
        .content {
          padding: 60px 40px 40px;
        }
        
        .donation-amount {
          text-align: center;
          margin-bottom: 40px;
        }
        
        .amount-label {
          font-size: 16px;
          color: #666;
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-weight: 500;
        }
        
        .amount-value {
          font-size: 48px;
          font-weight: 800;
          color: #2c3e50;
          margin: 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
        }
        
        .receipt-details {
          background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
          border-radius: 16px;
          padding: 30px;
          margin: 40px 0;
          border: 1px solid #e9ecef;
        }
        
        .detail-header {
          font-size: 18px;
          font-weight: 600;
          color: #2c3e50;
          margin-bottom: 20px;
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        
        .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 0;
          border-bottom: 1px solid rgba(0, 0, 0, 0.05);
        }
        
        .detail-row:last-child {
          border-bottom: none;
          padding-bottom: 0;
        }
        
        .detail-label {
          color: #666;
          font-weight: 500;
          font-size: 14px;
        }
        
        .detail-value {
          color: #2c3e50;
          font-weight: 600;
          font-size: 14px;
        }
        
        .tax-info {
          background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%);
          border: 1px solid #ffeaa7;
          border-radius: 16px;
          padding: 25px;
          margin: 30px 0;
          position: relative;
        }
        
        .tax-info::before {
          content: '🏛️';
          position: absolute;
          top: -15px;
          left: 25px;
          background: #ffeaa7;
          padding: 8px 12px;
          border-radius: 20px;
          font-size: 18px;
        }
        
        .tax-title {
          font-weight: 700;
          color: #856404;
          font-size: 16px;
          margin-bottom: 10px;
          margin-top: 5px;
        }
        
        .tax-details {
          color: #856404;
          font-size: 14px;
          line-height: 1.5;
        }
        
        .message-section {
          background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
          border: 1px solid #c3e6cb;
          border-radius: 16px;
          padding: 30px;
          margin: 30px 0;
          text-align: center;
          position: relative;
        }
        
        .message-section::before {
          content: '💝';
          position: absolute;
          top: -15px;
          left: 50%;
          transform: translateX(-50%);
          background: #c3e6cb;
          padding: 8px 12px;
          border-radius: 20px;
          font-size: 18px;
        }
        
        .message-text {
          color: #155724;
          font-size: 16px;
          font-weight: 500;
          line-height: 1.6;
          margin-top: 10px;
          font-style: italic;
        }
        
        .footer {
          background: #f8f9fa;
          padding: 30px 40px;
          text-align: center;
          border-top: 1px solid #e9ecef;
        }
        
        .footer-content {
          color: #6c757d;
          font-size: 13px;
          line-height: 1.5;
        }
        
        .footer-content strong {
          color: #495057;
        }
        
        .powered-by {
          margin-top: 20px;
          padding-top: 20px;
          border-top: 1px solid #dee2e6;
          color: #adb5bd;
          font-size: 12px;
        }
        
        .contact-info {
          margin: 15px 0;
        }
        
        .contact-info a {
          color: #007bff;
          text-decoration: none;
        }
        
        @media (max-width: 600px) {
          .email-wrapper { padding: 20px 10px; }
          .header { padding: 40px 20px; }
          .content { padding: 40px 20px 20px; }
          .footer { padding: 20px; }
          .amount-value { font-size: 36px; }
          .org-name { font-size: 24px; }
        }
      </style>
    </head>
    <body>
      <div class="email-wrapper">
        <div class="email-container">
          <!-- Header -->
          <div class="header">
            <div class="heart-icon">❤️</div>
            <h1 class="org-name">${safeOrgName}</h1>
            <p class="thank-you">Thank you for your generous donation</p>
          </div>
          
          <!-- Content -->
          <div class="content">
            <!-- Donation Amount -->
            <div class="donation-amount">
              <div class="amount-label">Donation Amount</div>
              <h2 class="amount-value">${data.donation.formattedAmount}</h2>
            </div>
            
            <!-- Receipt Details -->
            <div class="receipt-details">
              <div class="detail-header">
                📋 Receipt Details
              </div>
              <div class="detail-row">
                <span class="detail-label">Date</span>
                <span class="detail-value">${data.donation.date}</span>
              </div>
              <div class="detail-row">
                <span class="detail-label">Transaction ID</span>
                <span class="detail-value">${safeTransactionId}</span>
              </div>
              ${safeOrderId ? `
              <div class="detail-row">
                <span class="detail-label">Order ID</span>
                <span class="detail-value">${safeOrderId}</span>
              </div>
              ` : ''}
              <div class="detail-row">
                <span class="detail-label">Organization</span>
                <span class="detail-value">${safeOrgName}</span>
              </div>
            </div>
            
            <!-- Tax Information -->
            ${safeTaxId ? `
            <div class="tax-info">
              <div class="tax-title">Tax Deductible Donation</div>
              <div class="tax-details">
                <strong>Organization:</strong> ${safeOrgName}<br>
                <strong>Tax ID (EIN):</strong> ${safeTaxId}<br>
                <strong>Important:</strong> Please keep this receipt for your tax records. This donation may be tax-deductible according to IRS guidelines.
              </div>
            </div>
            ` : ''}
            
            <!-- Thank You Message -->
            <div class="message-section">
              <div class="message-text">${safeMessage}</div>
            </div>
          </div>
          
          <!-- Footer -->
          <div class="footer">
            <div class="footer-content">
              <strong>Receipt Information</strong><br>
              This receipt was generated automatically on ${data.donation.date}.<br>
              Please keep this email for your records.
              
              ${data.organization.contactEmail ? `
              <div class="contact-info">
                Questions? Contact us at <a href="mailto:${data.organization.contactEmail}">${data.organization.contactEmail}</a>
              </div>
              ` : ''}
              
              ${data.organization.website ? `
              <div class="contact-info">
                Visit our website: <a href="${data.organization.website}">${data.organization.website}</a>
              </div>
              ` : ''}
            </div>
            
            <div class="powered-by">
              Powered by ShulPad
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `
}

// ✅ FIXED: Added the missing generateReceiptText function
function generateReceiptText(data: ReceiptData): string {
  // Helper function to clean text for plain text email (remove HTML entities, etc.)
  const cleanText = (text: string): string => {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .trim()
  }

  const lines: string[] = []
  
  // Header
  lines.push("DONATION RECEIPT")
  lines.push("=" + "=".repeat(47))
  lines.push("")
  lines.push(cleanText(data.organization.name))
  lines.push("")
  
  // Receipt details
  lines.push("Receipt Details:")
  lines.push("-".repeat(20))
  lines.push(`Date: ${data.donation.date}`)
  lines.push(`Transaction ID: ${data.donation.transactionId}`)
  
  if (data.donation.orderId) {
    lines.push(`Order ID: ${data.donation.orderId}`)
  }
  
  lines.push(`Donation Amount: ${data.donation.formattedAmount}`)
  lines.push("")
  
  // Tax information
  if (data.organization.taxId) {
    lines.push("Tax Information:")
    lines.push("-".repeat(20))
    lines.push(`This donation was made to ${cleanText(data.organization.name)}`)
    lines.push(`Tax ID (EIN): ${data.organization.taxId}`)
    lines.push("Keep this receipt for your tax records.")
    lines.push("")
  }
  
  // Message
  lines.push(cleanText(data.organization.message))
  lines.push("")
  
  // Footer
  lines.push("-".repeat(48))
  lines.push("This receipt was generated automatically.")
  
  if (data.organization.contactEmail) {
    lines.push(`Questions? Contact us at ${data.organization.contactEmail}`)
  }
  
  if (data.organization.website) {
    lines.push(`Visit us: ${data.organization.website}`)
  }
  
  lines.push("Powered by CharityPad")
  
  return lines.join("\n")
}