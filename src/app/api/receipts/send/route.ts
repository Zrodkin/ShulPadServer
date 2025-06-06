// src/app/api/receipts/send/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/db" // Assuming this is your DB client setup
import { logger } from "@/lib/logger" // Assuming this is your logger setup
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
  transaction_id?: string; // Kept for logging, but not displayed on new receipt
  order_id?: string;       // Kept for logging, but not displayed on new receipt
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
    transactionId: string; // Used for SendGrid customArgs, not displayed
    orderId?: string;       // Not displayed
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
      transaction_id, // Pass for logging/customArgs if needed
      order_id,       // Pass for logging/customArgs if needed
      payment_date,
      donor_email
    })

    // Send email with retry logic
    const emailResult = await sendReceiptEmail(receiptData, orgSettings)
    
    if (emailResult.success) {
      // Update receipt log with success
      if (receiptLogId !== null) {
        await updateReceiptLogSuccess(db, receiptLogId, emailResult.messageId!)
      }
      
      logger.info("Receipt sent successfully", { 
        organization_id, 
        donor_email, 
        amount, 
        transaction_id, // Logged, not displayed
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
      if (receiptLogId !== null) {
        await updateReceiptLogFailure(db, receiptLogId, emailResult.error!)
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
    if (receiptLogId !== null) {
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
      // Ensure db.end is only called if db client was initialized successfully
      if (db && typeof db.end === 'function') {
        await db.end()
      }
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

  if (body.amount && body.amount > 1000000) { // Example reasonable maximum
    errors.push("amount exceeds maximum allowed value")
  }
  
  // Optional fields validation (type checks if present)
  if (body.transaction_id && typeof body.transaction_id !== 'string') {
    errors.push("transaction_id must be a string if provided")
  }
  if (body.order_id && typeof body.order_id !== 'string') {
    errors.push("order_id must be a string if provided")
  }
  if (body.payment_date && typeof body.payment_date !== 'string') {
      errors.push("payment_date must be a string if provided")
  } else if (body.payment_date && isNaN(Date.parse(body.payment_date))) {
      errors.push("payment_date must be a valid date string if provided")
  }


  return { valid: errors.length === 0, errors }
}

// Rate limiting function
function checkRateLimit(organizationId: string): RateLimitResult {
  const now = Date.now()
  const key = `receipt_${organizationId}`
  const existing = rateLimitMap.get(key)

  if (!existing || now > existing.resetTime) {
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW })
    return { allowed: true, resetTime: now + RATE_LIMIT_WINDOW }
  }

  if (existing.count >= RATE_LIMIT_MAX) {
    return { allowed: false, resetTime: existing.resetTime }
  }

  existing.count++
  rateLimitMap.set(key, existing) // Update existing entry
  return { allowed: true, resetTime: existing.resetTime }
}

// Get organization settings
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
    // For white-label app, organization settings must be provided in the request body.
    if (!providedSettings || !providedSettings.organization_name) {
      logger.error("Organization settings (name) not provided in request for white-label app", { organizationId })
      return null; // Critical information missing
    }
    
    // Construct settings from provided data.
    // Add defaults for optional fields if not provided.
    return {
      id: organizationId,
      name: providedSettings.organization_name,
      tax_id: providedSettings.organization_tax_id || "", // Default to empty string if not provided
      receipt_message: providedSettings.organization_receipt_message || "Thank you for your generous donation!",
      logo_url: undefined, // White-label might not pass logo_url, contact_email, website via request body.
      contact_email: undefined, // These could be fetched from a DB if a full org profile existed.
      website: undefined,     // For this specific API, we rely on what's passed.
      receipt_enabled: true // Assuming if this endpoint is hit for a white-label, receipts are enabled.
                            // A more robust system might check a flag in a DB.
    };
    
  } catch (error) {
    logger.error("Error processing organization settings", { error, organizationId });
    return null;
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
      [
        data.organization_id, 
        data.donor_email, 
        data.amount, 
        data.transaction_id || null, // Ensure null if undefined
        data.order_id || null       // Ensure null if undefined
      ]
    )
    return result.rows[0].id
  } catch (error) {
    logger.error("Database error creating receipt log entry", { error, data })
    throw error // Rethrow to be caught by main handler
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
    // Do not rethrow, as email sending was successful. Log and continue.
  }
}

async function updateReceiptLogFailure(db: any, receiptLogId: number, errorMsg: string): Promise<void> {
  try {
    // Truncate error message if too long for DB column
    const MAX_ERROR_LENGTH = 255; // Example, adjust to your DB schema
    const truncatedError = errorMsg.length > MAX_ERROR_LENGTH ? errorMsg.substring(0, MAX_ERROR_LENGTH) : errorMsg;

    await db.query(
      `UPDATE receipt_log 
       SET delivery_status = 'failed', 
           delivery_error = $1,
           retry_count = retry_count + 1,
           last_retry_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [truncatedError, receiptLogId]
    )
  } catch (dbError) {
    logger.error("Database error updating receipt log failure", { error: dbError, receiptLogId, originalError: errorMsg })
    // Do not rethrow, main error handling will manage response. Log and continue.
  }
}

// Generate receipt data (content for the email)
function generateReceiptData(orgSettings: OrganizationSettings, donationData: {
  amount: number;
  transaction_id?: string;
  order_id?: string;
  payment_date?: string;
  donor_email: string;
}): ReceiptData {
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
      transactionId: donationData.transaction_id || `TXN-${Date.now()}`, // Kept for internal use / SendGrid custom args
      orderId: donationData.order_id, // Kept for internal use
      date: formattedDate,
      year: donationDate.getFullYear()
    },
    donor: {
      email: donationData.donor_email
    }
  };
}

// Email sending function
async function sendReceiptEmail(receiptData: ReceiptData, orgSettings: OrganizationSettings): Promise<EmailResult> {
  try {
    const htmlContent = generateReceiptHTML(receiptData);
    const textContent = generateReceiptText(receiptData); // Also update text version for consistency

    const msg = {
      to: receiptData.donor.email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'hello@charitypad.com', // More generic if used by many
        name: orgSettings.name
      },
      subject: 'Thank You For Your Donation!', // <-- SUBJECT LINE CHANGED
      text: textContent,
      html: htmlContent,
      categories: ['donation-receipt', `org-${orgSettings.id}`],
      customArgs: {
        organization_id: orgSettings.id,
        // transaction_id is useful for SendGrid tracking even if not on receipt face
        transaction_id: receiptData.donation.transactionId, 
        amount: receiptData.donation.amount.toString()
      },
      trackingSettings: {
        clickTracking: { enable: true, enableText: true }, // Consider enabling for links
        openTracking: { enable: true },
        subscriptionTracking: { enable: false }
      }
    };

    const response = await sgMail.send(msg);
    // Ensure response and headers are as expected before accessing x-message-id
    const messageId = (response && response[0] && response[0].headers && response[0].headers['x-message-id']) 
                      ? response[0].headers['x-message-id'] 
                      : undefined;
    
    return { success: true, messageId };

  } catch (sendGridError: any) {
    let errorMessage = "Unknown SendGrid error";
    if (sendGridError.response && sendGridError.response.body && sendGridError.response.body.errors) {
      errorMessage = `SendGrid API error: ${sendGridError.response.body.errors.map((e: any) => e.message).join(', ')}`;
    } else if (sendGridError.message) {
      errorMessage = sendGridError.message;
    }
    
    logger.error("SendGrid sending error", { 
      error: sendGridError, 
      responseBody: sendGridError.response?.body 
    });
    return { success: false, error: errorMessage };
  }
}

// --- MODIFIED HTML Receipt Generation ---
function generateReceiptHTML(data: ReceiptData): string {
  // Helper to escape HTML special characters
  const escapeHtml = (unsafeText: string | undefined): string => {
    if (unsafeText === undefined || unsafeText === null) return '';
    return unsafeText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  const safeOrgName = escapeHtml(data.organization.name);
  const safeTaxId = escapeHtml(data.organization.taxId);
  const orgLogoUrl = data.organization.logoUrl ? escapeHtml(data.organization.logoUrl) : '';
  const orgContactEmail = data.organization.contactEmail ? escapeHtml(data.organization.contactEmail) : '';
  const orgWebsite = data.organization.website ? escapeHtml(data.organization.website) : '';

  // Define common styles to ensure consistency and reduce redundancy (applied inline)
 const styles = {
  body: `font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 16px; line-height: 1.6em; color: #333333; margin: 0; padding: 0; width: 100% !important; -webkit-font-smoothing: antialiased; background-color: #f4f4f7;`,
  emailWrapper: `width: 100%; margin: 0; padding: 20px 0; background-color: #f4f4f7;`,
  emailContainer: `max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); overflow: hidden;`,
  header: `padding: 30px 30px 20px; text-align: center; border-bottom: 1px solid #eeeeee;`,
  logo: `max-height: 70px; max-width: 200px; margin-bottom: 20px;`,
  orgName: `font-size: 26px; font-weight: bold; color: #222222; margin-bottom: 5px;`,
  receiptSubject: `font-size: 17px; color: #555555; font-weight: 500;`,
  contentPadding: `padding: 25px 30px;`,
  thankYouNote: `font-size: 16px; color: #444444; margin-bottom: 25px; text-align: center; line-height: 1.6em;`,

  detailsTable: `width: 100%; margin-bottom: 25px; border-collapse: collapse;`,
  detailsTh: `padding: 12px 0; text-align: left; font-weight: bold; color: #444444; border-bottom: 1px solid #dddddd; vertical-align: top;`,
  detailsTd: `padding: 12px 0; text-align: right; color: #555555; border-bottom: 1px solid #dddddd; vertical-align: top;`,
  // CHANGED: Reduced font size and adjusted styling
  amountValue: `font-size: 18px; font-weight: 600; color: #2563eb;`, // Smaller, less bold, blue color
  footer: `text-align: center; padding: 12px 30px; border-top: 1px solid #eeeeee; font-size: 12px; color: #888888; background-color: #f9f9f9;`,
  footerLink: `color: #007bff; text-decoration: none;`,
  footerP: `margin: 5px 0;`
};


  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Donation Receipt - ${safeOrgName}</title>
    <style type="text/css">
      body { ${styles.body} }
      /* Some styles are better in head for clients that support it, but primary styling is inline */
      a { color: #007bff; text-decoration: none; }
    </style>
  </head>
  <body style="${styles.body}">
    <table cellpadding="0" cellspacing="0" border="0" style="${styles.emailWrapper}">
      <tr>
        <td align="center">
          <div style="${styles.emailContainer}">
            <div style="${styles.header}">
              ${orgLogoUrl ? `<img src="${orgLogoUrl}" alt="${safeOrgName} Logo" style="${styles.logo}" />` : ''}
              <div style="${styles.orgName}">${safeOrgName}</div>
              <div style="${styles.receiptSubject}">Donation Receipt</div>
            </div>

            <div style="${styles.contentPadding}">
              <p style="${styles.thankYouNote}">
                Thank you for your generous contribution to ${safeOrgName}. Your support is greatly appreciated and helps us continue our mission.
              </p>
            </div>

            <div style="padding: 0 30px 25px;">
              <table cellpadding="0" cellspacing="0" border="0" style="${styles.detailsTable}">
                <tr>
                  <th style="${styles.detailsTh} width: 40%;">Donation Amount</th>
                  <td style="${styles.detailsTd}"><span style="${styles.amountValue}">${data.donation.formattedAmount}</span></td>
                </tr>
                <tr>
                  <th style="${styles.detailsTh}">Date of Donation</th>
                  <td style="${styles.detailsTd}">${escapeHtml(data.donation.date)}</td>
                </tr>
                ${safeTaxId ? `
                <tr>
                  <th style="${styles.detailsTh}">Tax ID (EIN)</th>
                  <td style="${styles.detailsTd}">${safeTaxId}</td>
                </tr>
                ` : ''}
              </table>
            </div>

            <div style="${styles.footer}">
              ${orgContactEmail ? `<p style="${styles.footerP}">Questions? <a href="mailto:${orgContactEmail}" style="${styles.footerLink}">${orgContactEmail}</a></p>` : ''}
              ${orgWebsite ? `<p style="${styles.footerP}">Visit our website: <a href="${orgWebsite}" target="_blank" style="${styles.footerLink}">${orgWebsite}</a></p>` : ''}
              <p style="${styles.footerP} margin-top:10px;">Powered by ShulPad</p>
            </div>
          </div>
        </td>
      </tr>
    </table>
  </body>
  </html>`;
}

// --- MODIFIED Text Receipt Generation (for consistency with HTML version) ---
function generateReceiptText(data: ReceiptData): string {
  const escapeText = (unsafeText: string | undefined): string => {
    if (unsafeText === undefined || unsafeText === null) return '';
    // Basic text cleaning, can be expanded
    return unsafeText.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, "");
  };

  const safeOrgName = escapeText(data.organization.name);
  const safeTaxId = escapeText(data.organization.taxId);
  const orgContactEmail = escapeText(data.organization.contactEmail);
  const orgWebsite = escapeText(data.organization.website);

  let receipt = `OFFICIAL DONATION RECEIPT\n`;
  receipt += `==================================================\n\n`;
  receipt += `${safeOrgName}\n\n`;

  receipt += `Thank you for your generous contribution to ${safeOrgName}. Your support is greatly appreciated and helps us continue our mission.\n\n`;

  receipt += `DONATION DETAILS:\n`;
  receipt += `--------------------------------------------------\n`;
  receipt += `Donation Amount: ${data.donation.formattedAmount}\n`;
  receipt += `Date of Donation: ${data.donation.date}\n`;
  if (safeTaxId) {
    receipt += `Tax ID (EIN): ${safeTaxId}\n`;
  }
  receipt += `\n`;

  receipt += `--------------------------------------------------\n`;
  if (orgContactEmail) {
    receipt += `Questions? Contact us at ${orgContactEmail}\n`;
  }
  if (orgWebsite) {
    receipt += `Visit our website: ${orgWebsite}\n`;
  }
  receipt += `Powered by CharityPad\n`;

  return receipt;
}