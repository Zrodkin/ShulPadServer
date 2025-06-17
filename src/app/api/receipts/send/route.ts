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
   include_pdf?: boolean;
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
      payment_date,
      include_pdf = true
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
    const emailResult = await sendReceiptEmail(receiptData, orgSettings, include_pdf);
    
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
    const result = await db.execute(
      `INSERT INTO receipt_log (
        organization_id, 
        donor_email, 
        amount, 
        transaction_id, 
        order_id,
        delivery_status,
        requested_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
      [
        data.organization_id, 
        data.donor_email, 
        data.amount, 
        data.transaction_id || null,
        data.order_id || null
      ]
    )
    return result.insertId  // PlanetScale automatically provides the inserted ID
  } catch (error) {
    logger.error("Database error creating receipt log entry", { error, data })
    throw error
  }
}

async function updateReceiptLogSuccess(db: any, receiptLogId: number, messageId: string): Promise<void> {
  try {
    await db.execute(
      `UPDATE receipt_log 
SET delivery_status = 'sent', 
    sent_at = NOW(), 
    sendgrid_message_id = ?,
    updated_at = NOW()
WHERE id = ?`,
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

    await db.execute(
      `UPDATE receipt_log 
SET delivery_status = 'failed', 
    delivery_error = ?,
    retry_count = retry_count + 1,
    last_retry_at = NOW(),
    updated_at = NOW()
WHERE id = ?`,
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
async function sendReceiptEmail(receiptData: ReceiptData, orgSettings: OrganizationSettings, includePDF: boolean = false): Promise<EmailResult> {
  try {
    const htmlContent = generateReceiptHTML(receiptData);
    const textContent = generateReceiptText(receiptData);
    
    // Generate PDF attachment if requested
    let attachments = undefined;
    if (includePDF) {
      try {
        const pdfBuffer = await generateTaxInvoicePDF(receiptData);
        attachments = [{
          content: pdfBuffer.toString('base64'),
          filename: `Tax_Receipt_${receiptData.donation.transactionId}.pdf`,
          type: 'application/pdf',
          disposition: 'attachment'
        }];
      } catch (pdfError) {
        logger.error("Failed to generate PDF attachment", { error: pdfError });
        // Continue without PDF - don't fail the entire email
      }
    }

    const msg = {
      to: receiptData.donor.email,
      from: {
        email: process.env.SENDGRID_FROM_EMAIL || 'hello@shulpad.com',
        name: 'ShulPad'
      },
      subject: 'Thank You For Your Donation!',
      text: textContent,
      html: htmlContent,
      ...(attachments && { attachments }), // Only add if PDF was generated
      categories: ['donation-receipt', `org-${orgSettings.id}`],
      customArgs: {
        organization_id: orgSettings.id,
        transaction_id: receiptData.donation.transactionId,
        amount: receiptData.donation.amount.toString(),
        has_pdf: includePDF.toString() // Track PDF inclusion
      },
      trackingSettings: {
        clickTracking: { enable: true, enableText: true },
        openTracking: { enable: true },
        subscriptionTracking: { enable: false }
      }
    };

    const response = await sgMail.send(msg);
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


// Fixed generateReceiptHTML function with better margins and layout
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
  const orgContactEmail = data.organization.contactEmail ? escapeHtml(data.organization.contactEmail) : '';
  const orgWebsite = data.organization.website ? escapeHtml(data.organization.website) : '';

  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Donation Receipt - ${safeOrgName}</title>
    <style type="text/css">
      body { 
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; 
        font-size: 16px; 
        line-height: 1.6em; 
        color: #333333; 
        margin: 0; 
        padding: 20px; 
        width: 100% !important; 
        -webkit-font-smoothing: antialiased; 
        background-color: #f4f4f7;
        box-sizing: border-box;
      }
      
      .email-container {
        max-width: 600px; 
        margin: 0 auto; 
        background-color: #ffffff; 
        border-radius: 8px; 
        box-shadow: 0 4px 15px rgba(0,0,0,0.1); 
        overflow: hidden;
      }
      
      .header {
        padding: 40px 40px 30px; 
        text-align: center; 
        border-bottom: 1px solid #eeeeee;
      }
      
      .org-name {
        font-size: 28px; 
        font-weight: bold; 
        color: #222222; 
        margin: 0 0 8px 0;
      }
      
      .receipt-subject {
        font-size: 18px; 
        color: #555555; 
        font-weight: 500;
        margin: 0;
      }
      
      .content {
        padding: 30px 40px;
      }
      
      .thank-you-note {
        font-size: 16px; 
        color: #444444; 
        margin: 0 0 30px 0; 
        text-align: center; 
        line-height: 1.6em;
      }
      
      .details-table {
        width: 100%; 
        margin: 0; 
        border-collapse: collapse;
      }
      
      .details-table th {
        padding: 15px 0; 
        text-align: left; 
        font-weight: bold; 
        color: #444444; 
        border-bottom: 1px solid #dddddd; 
        vertical-align: top; 
        width: 40%;
        font-size: 16px;
      }
      
      .details-table td {
        padding: 15px 0; 
        text-align: right; 
        color: #555555; 
        border-bottom: 1px solid #dddddd; 
        vertical-align: top; 
        width: 60%;
        font-size: 16px;
      }
      
      .amount-value {
        font-size: 20px; 
        font-weight: 600; 
        color: #2563eb;
      }
      
      .footer {
        text-align: center; 
        padding: 25px 40px; 
        border-top: 1px solid #eeeeee; 
        font-size: 14px; 
        color: #888888; 
        background-color: #f9f9f9;
      }
      
      .footer p {
        margin: 8px 0;
      }
      
      .footer a {
        color: #007bff; 
        text-decoration: none;
      }
      
      .footer a:hover {
        text-decoration: underline;
      }
      
      /* Mobile responsive */
      @media screen and (max-width: 600px) {
        body {
          padding: 10px;
        }
        
        .header {
          padding: 30px 25px 20px;
        }
        
        .content {
          padding: 25px 25px;
        }
        
        .footer {
          padding: 20px 25px;
        }
        
        .org-name {
          font-size: 24px;
        }
        
        .details-table th,
        .details-table td {
          padding: 12px 0;
          font-size: 15px;
        }
        
        .amount-value {
          font-size: 18px;
        }
      }
    </style>
  </head>
  <body>
    <div class="email-container">
      <div class="header">
        <div class="org-name">${safeOrgName}</div>
        <div class="receipt-subject">Donation Receipt</div>
      </div>

      <div class="content">
        <p class="thank-you-note">
          Thank you for your generous contribution to ${safeOrgName}. Your support is greatly appreciated and helps us continue our mission.
        </p>

        <table class="details-table" cellpadding="0" cellspacing="0" border="0">
          <tr>
            <th>Amount</th>
            <td>${data.donation.formattedAmount}</td>
          </tr>
          <tr>
            <th>Date</th>
            <td>${escapeHtml(data.donation.date)}</td>
          </tr>
          ${safeTaxId ? `
          <tr>
            <th>Tax ID (EIN)</th>
            <td>${safeTaxId}</td>
          </tr>
          ` : ''}
        </table>
      </div>

      <div class="footer">
        ${orgContactEmail ? `<p>Questions? <a href="mailto:${orgContactEmail}">${orgContactEmail}</a></p>` : ''}
        ${orgWebsite ? `<p>Visit our website: <a href="${orgWebsite}" target="_blank">${orgWebsite}</a></p>` : ''}
        <p style="margin-top: 15px;">Powered by Shulpad</p>
      </div>
    </div>
  </body>
  </html>`;
}

// --- MODIFIED Text Receipt Generation (for consistency with HTML version) ---
// Updated generateReceiptText function to match the new receipt design
function generateReceiptText(data: ReceiptData): string {
  const escapeText = (unsafeText: string | undefined): string => {
    if (unsafeText === undefined || unsafeText === null) return '';
    // Basic text cleaning, can be expanded
    return unsafeText.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, "");
  };

  const safeOrgName = escapeText(data.organization.name);
  const safeTaxId = escapeText(data.organization.taxId);
  const safeReceiptMessage = escapeText(data.organization.message);
  const orgContactEmail = escapeText(data.organization.contactEmail);
  const orgWebsite = escapeText(data.organization.website);

  let receipt = `THANK YOU FOR YOUR GENEROUS DONATION\n`;
  receipt += `==================================================\n\n`;
  receipt += `${safeOrgName}\n`;
  receipt += `DONATION RECEIPT\n`;
  receipt += `${data.donation.date}\n\n`;

  receipt += `RECEIPT DETAILS:\n`;
  receipt += `--------------------------------------------------\n`;
  receipt += `Donor Email: ${data.donor.email}\n`;
  receipt += `Donation Date: ${data.donation.date}\n`;
  if (safeTaxId) {
    receipt += `Tax ID (EIN): ${safeTaxId}\n`;
  }
  receipt += `\n`;

  receipt += `DONATION AMOUNT                         TOTAL\n`;
  receipt += `==================================================\n`;
  receipt += `Charitable Donation                 ${data.donation.formattedAmount}\n`;
  receipt += `--------------------------------------------------\n\n`;

  // Custom message if different from default
  if (safeReceiptMessage && safeReceiptMessage !== 'Thank you for your generous donation!') {
    receipt += `"${safeReceiptMessage}"\n\n`;
  }

  receipt += `This receipt is for your tax records. Please retain for filing purposes.\n`;
  receipt += `Your generosity makes a difference!\n\n`;

  receipt += `--------------------------------------------------\n`;
  receipt += `${safeOrgName}\n`;
  if (orgContactEmail) {
    receipt += `Questions? Contact us at ${orgContactEmail}\n`;
  }
  if (orgWebsite) {
    receipt += `Visit our website: ${orgWebsite}\n`;
  }
  receipt += `Powered by Shulpad\n`;

  return receipt;
}

// Clean, simple generateTaxInvoicePDF function
async function generateTaxInvoicePDF(data: ReceiptData): Promise<Buffer> {
  logger.info("Starting clean PDF generation", { transactionId: data.donation.transactionId });
  
  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    
    // Beautiful gradient colors
    const primaryBlue = [67, 153, 225];      // #4299e1
    const darkBlue = [49, 130, 206];         // #3182ce  
    const lightBlue = [235, 248, 255];       // #ebf8ff
    const green = [56, 161, 105];            // #38a169
    const darkGray = [45, 55, 72];           // #2d3748
    const mediumGray = [113, 128, 150];      // #718096
    const lightGray = [247, 250, 252];       // #f7fafc
    
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 25;
    
    let y = 40;
    
    // Header with gradient-like effect
    doc.setFillColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
    doc.rect(0, 0, pageWidth, 50, 'F');
    
    // Organization Name (Header)
    doc.setFontSize(24);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text(data.organization.name, pageWidth / 2, 25, { align: 'center' });
    
    // Receipt Title
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'normal');
    doc.text('Donation Receipt', pageWidth / 2, 35, { align: 'center' });
    
    y = 70;
    
    // Thank You Section with nice background
    doc.setFillColor(lightBlue[0], lightBlue[1], lightBlue[2]);
    doc.rect(margin, y - 5, pageWidth - (margin * 2), 30, 'F');
    
    doc.setFontSize(20);
    doc.setTextColor(darkBlue[0], darkBlue[1], darkBlue[2]);
    doc.setFont('helvetica', 'bold');
    doc.text('Thank You!', pageWidth / 2, y + 8, { align: 'center' });
    
    doc.setFontSize(12);
    doc.setTextColor(primaryBlue[0], primaryBlue[1], primaryBlue[2]);
    doc.setFont('helvetica', 'normal');
    doc.text('Your generous donation helps us continue our mission.', pageWidth / 2, y + 18, { align: 'center' });
    
    y += 50;
    
    // Donation Details Header
    doc.setFillColor(lightGray[0], lightGray[1], lightGray[2]);
    doc.rect(margin, y - 5, pageWidth - (margin * 2), 20, 'F');
    
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    doc.text('Donation Details', pageWidth / 2, y + 5, { align: 'center' });
    
    y += 30;
    
    // Amount
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('Donation Amount:', margin, y);
    doc.setFontSize(16);
    doc.setTextColor(green[0], green[1], green[2]);
    doc.setFont('helvetica', 'bold');
    doc.text(data.donation.formattedAmount, margin + 50, y);
    
    y += 15;
    
    // Date
    doc.setFontSize(12);
    doc.setTextColor(darkGray[0], darkGray[1], darkGray[2]);
    doc.setFont('helvetica', 'bold');
    doc.text('Date:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(data.donation.date, margin + 50, y);
    
    y += 15;
    
    // Donor Email
    doc.setFont('helvetica', 'bold');
    doc.text('Donor Email:', margin, y);
    doc.setFont('helvetica', 'normal');
    doc.text(data.donor.email, margin + 50, y);
    
    y += 15;
    
    // Tax ID (if available)
    if (data.organization.taxId) {
      doc.setFont('helvetica', 'bold');
      doc.text('Tax ID (EIN):', margin, y);
      doc.setFont('helvetica', 'normal');
      doc.text(data.organization.taxId, margin + 50, y);
      y += 15;
    }
    
    y += 20;
    
    // Custom Message (if different from default)
    if (data.organization.message && data.organization.message !== 'Thank you for your generous donation!') {
      doc.setFontSize(11);
      doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
      doc.setFont('helvetica', 'italic');
      const messageLines = doc.splitTextToSize(`"${data.organization.message}"`, pageWidth - (margin * 2));
      doc.text(messageLines, pageWidth / 2, y, { align: 'center' });
      y += messageLines.length * 5 + 20;
    }
    
    // Tax Notice with green theme
    doc.setFillColor(168, 230, 207); // Light green
    doc.rect(margin, y - 5, pageWidth - (margin * 2), 25, 'F');
    
    doc.setFontSize(11);
    doc.setTextColor(34, 84, 61); // Dark green
    doc.setFont('helvetica', 'bold');
    doc.text('This receipt is for your tax records. Please retain for filing purposes.', pageWidth / 2, y + 8, { align: 'center' });
    
    y += 40;
    
    // Footer
    doc.setFontSize(10);
    doc.setTextColor(mediumGray[0], mediumGray[1], mediumGray[2]);
    doc.setFont('helvetica', 'bold');
    doc.text(data.organization.name, pageWidth / 2, y, { align: 'center' });
    
    y += 8;
    
    if (data.organization.contactEmail) {
      doc.setFont('helvetica', 'normal');
      doc.text(`Questions? Contact us at ${data.organization.contactEmail}`, pageWidth / 2, y, { align: 'center' });
      y += 8;
    }
    
    if (data.organization.website) {
      doc.text(`Visit our website: ${data.organization.website}`, pageWidth / 2, y, { align: 'center' });
      y += 8;
    }
    
    y += 5;
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text('Powered by Shulpad', pageWidth / 2, y, { align: 'center' });
    
    // Convert to buffer
    const pdfArrayBuffer = doc.output('arraybuffer');
    const pdfBuffer = Buffer.from(pdfArrayBuffer);
    
    logger.info(`Clean PDF generated successfully, size: ${pdfBuffer.length} bytes`);
    return pdfBuffer;
    
  } catch (error) {
    logger.error("Error generating clean PDF", { error });
    throw error;
  }
}