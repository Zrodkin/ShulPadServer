// src/app/api/receipts/send/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { sql } from "@/lib/db"
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

    // Get organization settings from iOS app data
    const orgSettings = await getOrganizationSettings(organization_id, {
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

    // Create receipt log entry with Neon SQL
    try {
      const logResult = await sql`
        INSERT INTO receipt_log (
          organization_id, 
          donor_email, 
          amount, 
          transaction_id, 
          order_id,
          delivery_status,
          requested_at
        ) VALUES (
          ${organization_id}, 
          ${donor_email}, 
          ${amount}, 
          ${transaction_id || null}, 
          ${order_id || null},
          'pending', 
          NOW()
        )
        RETURNING id
      `
      
      receiptLogId = logResult[0].id
    } catch (dbError) {
      logger.error("Database error creating receipt log", { error: dbError, organization_id })
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

    // Generate receipt content
    const receiptData = generateReceiptData(orgSettings, {
      amount,
      transaction_id,
      order_id,
      payment_date,
      donor_email
    })

    // Send email
    const emailResult = await sendReceiptEmail(receiptData, orgSettings)
        
    if (emailResult.success) {
      // Update receipt log with success
      try {
        await sql`
          UPDATE receipt_log 
          SET delivery_status = 'sent', 
              sent_at = NOW(), 
              sendgrid_message_id = ${emailResult.messageId || null},
              updated_at = NOW()
          WHERE id = ${receiptLogId}
        `
      } catch (updateError) {
        logger.warn("Failed to update receipt log with success", { error: updateError, receiptLogId })
      }
      
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
      try {
        await sql`
          UPDATE receipt_log 
          SET delivery_status = 'failed', 
              delivery_error = ${emailResult.error || 'Unknown error'},
              retry_count = retry_count + 1,
              last_retry_at = NOW(),
              updated_at = NOW()
          WHERE id = ${receiptLogId}
        `
      } catch (updateError) {
        logger.warn("Failed to update receipt log with failure", { error: updateError, receiptLogId })
      }
      
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
        await sql`
          UPDATE receipt_log 
          SET delivery_status = 'failed', 
              delivery_error = ${error.message},
              retry_count = retry_count + 1,
              last_retry_at = NOW(),
              updated_at = NOW()
          WHERE id = ${receiptLogId}
        `
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

// Get organization settings from iOS app request data (white-label approach)
async function getOrganizationSettings(
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

// Generate receipt data
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

// Send receipt email via SendGrid
async function sendReceiptEmail(receiptData: ReceiptData, orgSettings: OrganizationSettings): Promise<EmailResult> {
  try {
    const htmlContent = generateReceiptHTML(receiptData)
    const textContent = generateReceiptText(receiptData)

    const msg = {
      to: receiptData.donor.email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'hello@shulpad.com',
        name: receiptData.organization.name || 'ShulPad'
      },
      subject: `Thank You For Your Donation to ${receiptData.organization.name}!`,
      text: textContent,
      html: htmlContent,
      categories: ['donation-receipt'],
      customArgs: {
        organization_id: orgSettings.id,
        transaction_id: receiptData.donation.transactionId,
        amount: receiptData.donation.amount.toString()
      },
      trackingSettings: {
        clickTracking: { enable: false },
        openTracking: { enable: true },
        subscriptionTracking: { enable: false }
      }
    }

    const response = await sgMail.send(msg)
    const messageId = response[0].headers['x-message-id'] as string
    
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

// Generate professional HTML receipt - Email client compatible
function generateReceiptHTML(data: ReceiptData): string {
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
  
  // Format date as "June 4th, 2025" style
  const formatDateWithOrdinal = (dateStr: string): string => {
    const date = new Date(dateStr)
    const day = date.getDate()
    const month = date.toLocaleDateString('en-US', { month: 'long' })
    const year = date.getFullYear()
    
    const getOrdinalSuffix = (day: number): string => {
      if (day > 3 && day < 21) return 'th'
      switch (day % 10) {
        case 1: return 'st'
        case 2: return 'nd'
        case 3: return 'rd'
        default: return 'th'
      }
    }
    
    return `${month} ${day}${getOrdinalSuffix(day)}, ${year}`
  }

  const formattedDate = formatDateWithOrdinal(data.donation.date)

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Thank You For Your Donation!</title>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <meta http-equiv="X-UA-Compatible" content="IE=edge" />
      <style type="text/css">
        /* Email client reset */
        body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
        table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
        img { -ms-interpolation-mode: bicubic; }
        
        /* Basic styling */
        body {
          margin: 0 !important;
          padding: 0 !important;
          font-family: Arial, sans-serif;
          background-color: #f4f4f4;
        }
        
        /* Mobile responsive */
        @media screen and (max-width: 600px) {
          .mobile-center { text-align: center !important; }
          .mobile-padding { padding: 15px !important; }
          .mobile-font { font-size: 16px !important; }
        }
      </style>
    </head>
    <body style="margin: 0; padding: 0; background-color: #f4f4f4;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width: 100%;">
        <tr>
          <td align="center" style="padding: 20px;">
            
            <!-- Main container -->
            <table border="0" cellpadding="0" cellspacing="0" width="600" style="max-width: 600px; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              
              <!-- Header -->
              <tr>
                <td align="center" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); padding: 40px 20px;">
                  <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: bold; text-align: center;">
                    ❤️ Thank You For Your Donation!
                  </h1>
                </td>
              </tr>
              
              <!-- Organization name -->
              <tr>
                <td align="center" style="padding: 30px 20px 20px;">
                  <h2 style="margin: 0; color: #028383; font-size: 24px; font-weight: normal; text-align: center;">
                    ${safeOrgName}
                  </h2>
                </td>
              </tr>
              
              <!-- Receipt details -->
              <tr>
                <td style="padding: 0 20px 20px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8f9fa; border-radius: 8px; overflow: hidden;">
                    
                    <!-- Details header -->
                    <tr>
                      <td colspan="2" style="background-color: #d7f1ff; padding: 15px 20px;">
                        <h3 style="margin: 0; color: #0066cc; font-size: 18px; font-weight: bold;">Receipt Details</h3>
                      </td>
                    </tr>
                    
                    <!-- Date row -->
                    <tr>
                      <td style="padding: 15px 20px; border-bottom: 1px solid #e9ecef; color: #666; font-weight: 500;">Date</td>
                      <td style="padding: 15px 20px; border-bottom: 1px solid #e9ecef; color: #2c3e50; font-weight: 600; text-align: right;">${formattedDate}</td>
                    </tr>
                    
                    <!-- Organization row -->
                    <tr>
                      <td style="padding: 15px 20px; border-bottom: 1px solid #e9ecef; color: #666; font-weight: 500;">Organization</td>
                      <td style="padding: 15px 20px; border-bottom: 1px solid #e9ecef; color: #2c3e50; font-weight: 600; text-align: right;">${safeOrgName}</td>
                    </tr>
                    
                    ${safeTaxId ? `
                    <!-- Tax ID row -->
                    <tr>
                      <td style="padding: 15px 20px; border-bottom: 1px solid #e9ecef; color: #666; font-weight: 500;">Tax ID</td>
                      <td style="padding: 15px 20px; border-bottom: 1px solid #e9ecef; color: #2c3e50; font-weight: 600; text-align: right;">${safeTaxId}</td>
                    </tr>
                    ` : ''}
                    
                    <!-- Amount row -->
                    <tr>
                      <td style="padding: 15px 20px; color: #666; font-weight: 500;">Donation Amount</td>
                      <td style="padding: 15px 20px; color: #4facfe; font-weight: 800; font-size: 20px; text-align: right;">${data.donation.formattedAmount}</td>
                    </tr>
                    
                  </table>
                </td>
              </tr>
              
              <!-- Thank you message -->
              <tr>
                <td style="padding: 20px;">
                  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%); border-radius: 8px;">
                    <tr>
                      <td style="padding: 25px; text-align: center;">
                        <p style="margin: 0; color: #155724; font-size: 16px; font-weight: 500; line-height: 1.5;">
                          ${safeMessage}
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              
              <!-- Footer -->
              <tr>
                <td style="padding: 20px; background-color: #f8f9fa; text-align: center; border-top: 1px solid #e9ecef;">
                  <p style="margin: 0 0 10px 0; font-size: 14px; color: #6c757d; line-height: 1.4;">
                    Please keep this receipt for your tax records.
                  </p>
                  <p style="margin: 0; font-size: 12px; color: #adb5bd;">
                    Powered by ShulPad
                  </p>
                </td>
              </tr>
              
            </table>
            
          </td>
        </tr>
      </table>
    </body>
    </html>
  `
}

// Generate plain text receipt
function generateReceiptText(data: ReceiptData): string {
  const cleanText = (text: string): string => {
    return text
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .trim()
  }

  const formatDateWithOrdinal = (dateStr: string): string => {
    const date = new Date(dateStr)
    const day = date.getDate()
    const month = date.toLocaleDateString('en-US', { month: 'long' })
    const year = date.getFullYear()
    
    const getOrdinalSuffix = (day: number): string => {
      if (day > 3 && day < 21) return 'th'
      switch (day % 10) {
        case 1: return 'st'
        case 2: return 'nd'
        case 3: return 'rd'
        default: return 'th'
      }
    }
    
    return `${month} ${day}${getOrdinalSuffix(day)}, ${year}`
  }

  const formattedDate = formatDateWithOrdinal(data.donation.date)

  const lines: string[] = []
  
  lines.push("THANK YOU FOR YOUR DONATION!")
  lines.push("=" + "=".repeat(31))
  lines.push("")
  lines.push(`Date: ${formattedDate}`)
  lines.push(`Organization: ${cleanText(data.organization.name)}`)
  if (data.organization.taxId) {
    lines.push(`Tax ID: ${cleanText(data.organization.taxId)}`)
  }
  lines.push(`Amount: ${data.donation.formattedAmount}`)
  if (data.donation.transactionId) {
    lines.push(`Transaction ID: ${data.donation.transactionId}`)
  }
  lines.push("")
  lines.push(cleanText(data.organization.message))
  lines.push("")
  lines.push("Please keep this receipt for your tax records.")
  lines.push("")
  lines.push("Powered by ShulPad")
  
  return lines.join("\n")
}