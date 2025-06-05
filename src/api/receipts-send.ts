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

// TypeScript interfaces
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

    // Generate receipt content
    const receiptData = generateReceiptData(orgSettings, {
      amount,
      transaction_id,
      order_id,
      payment_date,
      donor_email
    })

    // Send email with retry logic
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

// Validation function
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

// Rate limiting function
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

// Get organization settings from iOS app
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
    console.log("📧 Checking provided settings:", providedSettings)
    
    // Organization settings MUST be provided for white-label app
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

// Database functions
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

// Updated generateReceiptData function with new date format
function generateReceiptData(orgSettings: OrganizationSettings, donationData: any): ReceiptData {
  // Create a proper date formatter for the new format
  const donationDate = donationData.payment_date ? new Date(donationData.payment_date) : new Date();
  const formattedDate = donationDate.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

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
      date: formattedDate, // Now using the new format: "June 5, 2025"
      year: donationDate.getFullYear()
    },
    donor: {
      email: donationData.donor_email
    }
  }
}

// Email sending function
async function sendReceiptEmail(receiptData: ReceiptData, orgSettings: OrganizationSettings): Promise<EmailResult> {
  try {
    const htmlContent = generateReceiptHTML(receiptData)
    const textContent = generateReceiptText(receiptData)

    const msg = {
      to: receiptData.donor.email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'hello@shulpad.com',
       name: orgSettings.name
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

// Updated HTML receipt generation - REMOVED transaction ID and order ID, moved tax ID to main section
function generateReceiptHTML(data: ReceiptData): string {
  // Escape HTML to prevent XSS
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

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Donation Receipt</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          line-height: 1.6;
          color: #333;
          max-width: 600px;
          margin: 0 auto;
          padding: 20px;
          background-color: #f8f9fa;
        }
        .email-container {
          background-color: white;
          border-radius: 8px;
          padding: 30px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .header {
          text-align: center;
          border-bottom: 2px solid #4CAF50;
          padding-bottom: 20px;
          margin-bottom: 30px;
        }
        .logo {
          max-width: 120px;
          height: auto;
          margin-bottom: 15px;
        }
        .org-name {
          font-size: 24px;
          font-weight: bold;
          color: #2c3e50;
          margin: 10px 0;
        }
        .receipt-title {
          font-size: 18px;
          color: #4CAF50;
          font-weight: bold;
          margin: 20px 0;
        }
        .receipt-details {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
          margin: 20px 0;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          margin: 12px 0;
          padding: 8px 0;
          border-bottom: 1px solid #eee;
        }
        .detail-row:last-child {
          border-bottom: none;
          font-weight: bold;
          font-size: 18px;
          color: #4CAF50;
          margin-top: 16px;
        }
        .message {
          background: #e8f5e9;
          padding: 20px;
          border-radius: 8px;
          border-left: 4px solid #4CAF50;
          margin: 20px 0;
        }
        .footer {
          text-align: center;
          font-size: 12px;
          color: #666;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #eee;
        }
        .tax-note {
          margin: 20px 0;
          padding: 15px;
          background: #fff3cd;
          border: 1px solid #ffeaa7;
          border-radius: 5px;
          font-size: 14px;
        }
      </style>
    </head>
    <body>
      <div class="email-container">
        <div class="header">
          ${data.organization.logoUrl ? `<img src="${data.organization.logoUrl}" alt="Logo" class="logo">` : ''}
          <div class="org-name">${safeOrgName}</div>
          <div class="receipt-title">DONATION RECEIPT</div>
        </div>

        <div class="receipt-details">
          <div class="detail-row">
            <span>Date:</span>
            <span>${data.donation.date}</span>
          </div>
          ${safeTaxId ? `
          <div class="detail-row">
            <span>Tax ID (EIN):</span>
            <span>${safeTaxId}</span>
          </div>
          ` : ''}
          <div class="detail-row">
            <span>Donation Amount:</span>
            <span>${data.donation.formattedAmount}</span>
          </div>
        </div>

        <div class="message">
          ${safeMessage}
        </div>

        ${safeTaxId ? `
        <div class="tax-note">
          <strong>Tax Information:</strong><br>
          This donation was made to ${safeOrgName}. Keep this receipt for your tax records.
        </div>
        ` : ''}

        <div class="footer">
          <p>This receipt was generated automatically.</p>
          ${data.organization.contactEmail ? `<p>Questions? Contact us at ${data.organization.contactEmail}</p>` : ''}
          ${data.organization.website ? `<p>Visit us: ${data.organization.website}</p>` : ''}
          <p>Powered by CharityPad</p>
        </div>
      </div>
    </body>
    </html>
  `
}

// Updated text receipt generation - REMOVED transaction ID and order ID, moved tax ID to main section
function generateReceiptText(data: ReceiptData): string {
  // Helper function to clean text for plain text email
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
  
  if (data.organization.taxId) {
    lines.push(`Tax ID (EIN): ${data.organization.taxId}`)
  }
  
  lines.push(`Donation Amount: ${data.donation.formattedAmount}`)
  lines.push("")
  
  // Message
  lines.push(cleanText(data.organization.message))
  lines.push("")
  
  // Tax information note
  if (data.organization.taxId) {
    lines.push("Tax Information:")
    lines.push("-".repeat(20))
    lines.push(`This donation was made to ${cleanText(data.organization.name)}.`)
    lines.push("Keep this receipt for your tax records.")
    lines.push("")
  }
  
  // Footer
  lines.push("-".repeat(48))
  lines.push("This receipt was generated automatically.")
  
  if (data.organization.contactEmail) {
    lines.push(`Questions? Contact us at ${data.organization.contactEmail}`)
  }
  
  if (data.organization.website) {
    lines.push(`Visit us: ${data.organization.website}`)
  }
  
  lines.push("Powered by ShulPad")
  
  return lines.join("\n")
}