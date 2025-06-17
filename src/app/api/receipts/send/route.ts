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

// --- MODIFIED HTML Receipt Generation ---
// Updated generateReceiptHTML function with authentic receipt design
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
  const safeReceiptMessage = escapeHtml(data.organization.message);
  const orgLogoUrl = data.organization.logoUrl ? escapeHtml(data.organization.logoUrl) : '';
  const orgContactEmail = data.organization.contactEmail ? escapeHtml(data.organization.contactEmail) : '';
  const orgWebsite = data.organization.website ? escapeHtml(data.organization.website) : '';
  const safeDonorEmail = escapeHtml(data.donor.email);

  // Default Shulpad logo if organization doesn't have one
  const logoUrl = orgLogoUrl || 'https://i.imgur.com/G30gYf3.png';
  const logoAlt = orgLogoUrl ? `${safeOrgName} Logo` : 'Shulpad Logo';

  return `
<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html data-editor-version="2" class="sg-campaigns" xmlns="http://www.w3.org/1999/xhtml">
    <head>
      <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1">
      <!--[if !mso]><!-->
      <meta http-equiv="X-UA-Compatible" content="IE=Edge">
      <!--<![endif]-->
      <!--[if (gte mso 9)|(IE)]>
      <xml>
        <o:OfficeDocumentSettings>
          <o:AllowPNG/>
          <o:PixelsPerInch>96</o:PixelsPerInch>
        </o:OfficeDocumentSettings>
      </xml>
      <![endif]-->
      <!--[if (gte mso 9)|(IE)]>
  <style type="text/css">
    body {width: 600px;margin: 0 auto;}
    table {border-collapse: collapse;}
    table, td {mso-table-lspace: 0pt;mso-table-rspace: 0pt;}
    img {-ms-interpolation-mode: bicubic;}
  </style>
<![endif]-->
      <style type="text/css">
    body, p, div {
      font-family: inherit;
      font-size: 14px;
    }
    body {
      color: #000000;
    }
    body a {
      color: #1188E6;
      text-decoration: none;
    }
    p { margin: 0; padding: 0; }
    table.wrapper {
      width:100% !important;
      table-layout: fixed;
      -webkit-font-smoothing: antialiased;
      -webkit-text-size-adjust: 100%;
      -moz-text-size-adjust: 100%;
      -ms-text-size-adjust: 100%;
    }
    img.max-width {
      max-width: 100% !important;
    }
    .column.of-2 {
      width: 50%;
    }
    .column.of-3 {
      width: 33.333%;
    }
    .column.of-4 {
      width: 25%;
    }
    @media screen and (max-width:480px) {
      .preheader .rightColumnContent,
      .footer .rightColumnContent {
        text-align: left !important;
      }
      .preheader .rightColumnContent div,
      .preheader .rightColumnContent span,
      .footer .rightColumnContent div,
      .footer .rightColumnContent span {
        text-align: left !important;
      }
      .preheader .rightColumnContent,
      .preheader .leftColumnContent {
        font-size: 80% !important;
        padding: 5px 0;
      }
      table.wrapper-mobile {
        width: 100% !important;
        table-layout: fixed;
      }
      img.max-width {
        height: auto !important;
        max-width: 100% !important;
      }
      a.bulletproof-button {
        display: block !important;
        width: auto !important;
        font-size: 80%;
        padding-left: 0 !important;
        padding-right: 0 !important;
      }
      .columns {
        width: 100% !important;
      }
      .column {
        display: block !important;
        width: 100% !important;
        padding-left: 0 !important;
        padding-right: 0 !important;
        margin-left: 0 !important;
        margin-right: 0 !important;
      }
      .social-icon-column {
        display: inline-block !important;
      }
    }
  </style>
      <!--user entered Head Start--><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700&display=swap" rel="stylesheet"><style>
body {font-family: 'Inter', sans-serif;}
</style><!--End Head user entered-->
    </head>
    <body>
      <center class="wrapper" data-link-color="#1188E6" data-body-style="font-size:14px; font-family:inherit; color:#000000; background-color:#f1f5f9;">
        <div class="webkit">
          <table cellpadding="0" cellspacing="0" border="0" width="100%" class="wrapper" bgcolor="#f1f5f9">
            <tr>
              <td valign="top" bgcolor="#f1f5f9" width="100%">
                <table width="100%" role="content-container" class="outer" align="center" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td width="100%">
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td>
                            <!--[if mso]>
    <center>
    <table><tr><td width="600">
  <![endif]-->
                                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px;" align="center">
                                      <tr>
                                        <td role="modules-container" style="padding:0px 0px 0px 0px; color:#000000; text-align:left;" bgcolor="#FFFFFF" width="100%" align="left">
                                        
                                        <!-- Header Logo Section -->
                                        <table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" role="module" data-type="columns" style="padding:30px 0px 30px 0px;" bgcolor="#f8fafc" data-distribution="1">
                                          <tbody>
                                            <tr role="module-content">
                                              <td height="100%" valign="top">
                                                <table width="600" style="width:600px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-0">
                                                  <tbody>
                                                    <tr>
                                                      <td style="padding:0px;margin:0px;border-spacing:0;">
                                                        <table class="wrapper" role="module" data-type="image" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                                          <tbody>
                                                            <tr>
                                                              <td style="font-size:6px; line-height:10px; padding:0px 0px 0px 0px;" valign="top" align="center">
                                                                <img class="max-width" border="0" style="display:block; color:#000000; text-decoration:none; font-family:Inter, sans-serif; font-size:16px;" width="150" alt="${logoAlt}" data-proportionally-constrained="true" data-responsive="false" src="${logoUrl}" height="auto">
                                                              </td>
                                                            </tr>
                                                          </tbody>
                                                        </table>
                                                        
                                                        <!-- Organization Info -->
                                                        ${orgContactEmail || orgWebsite ? `
                                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                                          <tbody>
                                                            <tr>
                                                              <td style="padding:10px 0px 0px 0px; line-height:16px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content">
                                                                <div>
                                                                  ${orgContactEmail ? `<div style="font-family: inherit; text-align: center"><span style="color: #64748b; font-size: 10px">${orgContactEmail}</span></div>` : ''}
                                                                  ${orgWebsite ? `<div style="font-family: inherit; text-align: center"><span style="color: #64748b; font-size: 10px">${orgWebsite}</span></div>` : ''}
                                                                </div>
                                                              </td>
                                                            </tr>
                                                          </tbody>
                                                        </table>
                                                        ` : ''}
                                                      </td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Receipt Header -->
                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                          <tbody>
                                            <tr>
                                              <td style="padding:30px 0px 40px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content">
                                                <div>
                                                  <div style="font-family: inherit; text-align: center"><span style="color: #475569; font-size: 12px"><strong>THANK YOU FOR YOUR GENEROUS DONATION</strong></span></div>
                                                  <div style="font-family: inherit; text-align: center"><br></div>
                                                  <div style="font-family: inherit; text-align: center"><span style="color: #475569; font-size: 14px"><strong>${safeOrgName}</strong></span></div>
                                                  <div style="font-family: inherit; text-align: center"><span style="color: #475569; font-size: 12px"><strong>Donation Receipt</strong></span></div>
                                                  <div style="font-family: inherit; text-align: center"><span style="color: #475569; font-size: 12px">${escapeHtml(data.donation.date)}</span></div>
                                                </div>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Receipt Details -->
                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                          <tbody>
                                            <tr>
                                              <td style="padding:0px 40px 40px 40px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content">
                                                <div>
                                                  <div style="font-family: inherit; text-align: inherit"><span style="color: #475569; font-size: 12px"><strong>Donor Email:</strong></span><span style="color: #475569; font-size: 12px"> ${safeDonorEmail}</span></div>
                                                  <div style="font-family: inherit; text-align: inherit"><span style="color: #475569; font-size: 12px"><strong>Donation Date:</strong></span><span style="color: #475569; font-size: 12px"> ${escapeHtml(data.donation.date)}</span></div>
                                                  ${safeTaxId ? `<div style="font-family: inherit; text-align: inherit"><span style="color: #475569; font-size: 12px"><strong>Tax ID (EIN):</strong></span><span style="color: #475569; font-size: 12px"> ${safeTaxId}</span></div>` : ''}
                                                </div>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Divider -->
                                        <table class="module" role="module" data-type="divider" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                          <tbody>
                                            <tr>
                                              <td style="padding:0px 40px 0px 40px;" role="module-content" height="100%" valign="top" bgcolor="">
                                                <table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" height="2px" style="line-height:2px; font-size:2px;">
                                                  <tbody>
                                                    <tr>
                                                      <td style="padding:0px 0px 2px 0px;" bgcolor="#475569"></td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Amount Header -->
                                        <table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" role="module" data-type="columns" style="padding:0px 40px 0px 40px;" bgcolor="#FFFFFF" data-distribution="1,1">
                                          <tbody>
                                            <tr role="module-content">
                                              <td height="100%" valign="top">
                                                <table width="260" style="width:260px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-0">
                                                  <tbody>
                                                    <tr>
                                                      <td style="padding:0px;margin:0px;border-spacing:0;">
                                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                                          <tbody>
                                                            <tr>
                                                              <td style="padding:15px 0px 15px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content">
                                                                <div><div style="font-family: inherit; text-align: left"><span style="color: #475569; font-size: 12px"><strong>DONATION AMOUNT</strong></span></div></div>
                                                              </td>
                                                            </tr>
                                                          </tbody>
                                                        </table>
                                                      </td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                                <table width="260" style="width:260px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-1">
                                                  <tbody>
                                                    <tr>
                                                      <td style="padding:0px;margin:0px;border-spacing:0;">
                                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                                          <tbody>
                                                            <tr>
                                                              <td style="padding:15px 0px 15px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content">
                                                                <div><div style="font-family: inherit; text-align: right"><span style="color: #475569; font-size: 12px"><strong>TOTAL</strong></span></div></div>
                                                              </td>
                                                            </tr>
                                                          </tbody>
                                                        </table>
                                                      </td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Divider -->
                                        <table class="module" role="module" data-type="divider" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                          <tbody>
                                            <tr>
                                              <td style="padding:0px 40px 0px 40px;" role="module-content" height="100%" valign="top" bgcolor="">
                                                <table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" height="2px" style="line-height:2px; font-size:2px;">
                                                  <tbody>
                                                    <tr>
                                                      <td style="padding:0px 0px 2px 0px;" bgcolor="#475569"></td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Amount Details -->
                                        <table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" role="module" data-type="columns" style="padding:0px 40px 0px 40px;" bgcolor="#FFFFFF" data-distribution="1,1">
                                          <tbody>
                                            <tr role="module-content">
                                              <td height="100%" valign="top">
                                                <table width="260" style="width:260px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-0">
                                                  <tbody>
                                                    <tr>
                                                      <td style="padding:0px;margin:0px;border-spacing:0;">
                                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                                          <tbody>
                                                            <tr>
                                                              <td style="padding:15px 0px 15px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content">
                                                                <div><div style="font-family: inherit; text-align: left"><span style="color: #475569; font-size: 12px">Charitable Donation</span></div></div>
                                                              </td>
                                                            </tr>
                                                          </tbody>
                                                        </table>
                                                      </td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                                <table width="260" style="width:260px; border-spacing:0; border-collapse:collapse; margin:0px 0px 0px 0px;" cellpadding="0" cellspacing="0" align="left" border="0" bgcolor="" class="column column-1">
                                                  <tbody>
                                                    <tr>
                                                      <td style="padding:0px;margin:0px;border-spacing:0;">
                                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                                          <tbody>
                                                            <tr>
                                                              <td style="padding:15px 0px 15px 0px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content">
                                                                <div><div style="font-family: inherit; text-align: right"><span style="color: #1f2937; font-size: 16px; font-weight: bold">${data.donation.formattedAmount}</span></div></div>
                                                              </td>
                                                            </tr>
                                                          </tbody>
                                                        </table>
                                                      </td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Bottom Divider -->
                                        <table class="module" role="module" data-type="divider" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                          <tbody>
                                            <tr>
                                              <td style="padding:0px 40px 0px 40px;" role="module-content" height="100%" valign="top" bgcolor="">
                                                <table border="0" cellpadding="0" cellspacing="0" align="center" width="100%" height="1px" style="line-height:1px; font-size:1px;">
                                                  <tbody>
                                                    <tr>
                                                      <td style="padding:0px 0px 1px 0px;" bgcolor="#475569"></td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Spacer -->
                                        <table class="module" role="module" data-type="spacer" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                          <tbody>
                                            <tr>
                                              <td style="padding:0px 0px 30px 0px;" role="module-content" bgcolor="">
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Custom Message -->
                                        ${safeReceiptMessage && safeReceiptMessage !== 'Thank you for your generous donation!' ? `
                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                          <tbody>
                                            <tr>
                                              <td style="padding:20px 40px 20px 40px; line-height:22px; text-align:inherit;" height="100%" valign="top" bgcolor="" role="module-content">
                                                <div><div style="font-family: inherit; text-align: center"><span style="color: #475569; font-size: 12px; font-style: italic;">"${safeReceiptMessage}"</span></div></div>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>
                                        ` : ''}

                                        <!-- Tax Notice -->
                                        <table class="module" role="module" data-type="text" border="0" cellpadding="0" cellspacing="0" width="100%" style="table-layout: fixed;">
                                          <tbody>
                                            <tr>
                                              <td style="padding:40px 30px 40px 30px; line-height:22px; text-align:inherit; background-color:#475569;" height="100%" valign="top" bgcolor="#475569" role="module-content">
                                                <div>
                                                  <div style="font-family: inherit; text-align: center"><span style="color: #ffffff; font-size: 12px"><strong>This receipt is for your tax records. Please retain for filing purposes.</strong></span></div>
                                                  <div style="font-family: inherit; text-align: center"><br></div>
                                                  <div style="font-family: inherit; text-align: center"><span style="color: #ffffff; font-size: 12px"><strong>Your generosity makes a difference!</strong></span></div>
                                                </div>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        <!-- Footer -->
                                        <div data-role="module-unsubscribe" class="module" role="module" data-type="unsubscribe" style="background-color:#f8fafc; color:#64748b; font-size:12px; line-height:20px; padding:16px 16px 16px 16px; text-align:Center;">
                                          <div class="Unsubscribe--addressLine">
                                            <p class="Unsubscribe--senderName" style="font-size:12px; line-height:20px;">${safeOrgName}</p>
                                            ${orgContactEmail ? `<p style="font-size:12px; line-height:20px;">Questions? Contact us at <a href="mailto:${orgContactEmail}" style="color:#475569;">${orgContactEmail}</a></p>` : ''}
                                            ${orgWebsite ? `<p style="font-size:12px; line-height:20px;">Visit our website: <a href="${orgWebsite}" target="_blank" style="color:#475569;">${orgWebsite}</a></p>` : ''}
                                          </div>
                                        </div>

                                        <!-- Powered By -->
                                        <table border="0" cellpadding="0" cellspacing="0" class="module" data-role="module-button" data-type="button" role="module" style="table-layout:fixed;" width="100%">
                                          <tbody>
                                            <tr>
                                              <td align="center" bgcolor="#f8fafc" class="outer-td" style="padding:20px 0px 20px 0px; background-color:#f8fafc;">
                                                <table border="0" cellpadding="0" cellspacing="0" class="wrapper-mobile" style="text-align:center;">
                                                  <tbody>
                                                    <tr>
                                                      <td align="center" bgcolor="#f1f5f9" class="inner-td" style="border-radius:6px; font-size:16px; text-align:center; background-color:inherit;">
                                                        <a href="https://shulpad.com/" style="background-color:#f1f5f9; border:1px solid #f1f5f9; border-color:#f1f5f9; border-radius:25px; border-width:1px; color:#94a3b8; display:inline-block; font-size:10px; font-weight:normal; letter-spacing:0px; line-height:normal; padding:5px 18px 5px 18px; text-align:center; text-decoration:none; border-style:solid; font-family:Inter,sans-serif;" target="_blank">♥ POWERED BY SHULPAD</a>
                                                      </td>
                                                    </tr>
                                                  </tbody>
                                                </table>
                                              </td>
                                            </tr>
                                          </tbody>
                                        </table>

                                        </td>
                                      </tr>
                                    </table>
                                    <!--[if mso]>
                                  </td>
                                </tr>
                              </table>
                            </center>
                            <![endif]-->
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </div>
      </center>
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

// Add PDF generation function
// Alternative PDF generation using jsPDF
// Updated generateTaxInvoicePDF function with modern styling
async function generateTaxInvoicePDF(data: ReceiptData): Promise<Buffer> {
  logger.info("Starting PDF generation with modern styling", { transactionId: data.donation.transactionId });
  
  try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    
    // Define colors matching our email template
    const colors = {
      primary: [71, 85, 105],     // #475569 (slate)
      secondary: [100, 116, 139], // #64748b (lighter slate)
      accent: [31, 41, 55],       // #1f2937 (dark gray for amount)
      light: [248, 250, 252],     // #f8fafc (very light gray)
      white: [255, 255, 255],     // #ffffff
      text: [55, 65, 81]          // #374151 (main text)
    };
    
    // Page dimensions
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 30;
    const contentWidth = pageWidth - (margin * 2);
    
    // Helper function to add a colored rectangle
    const addColoredRect = (x: number, y: number, width: number, height: number, color: number[]) => {
      doc.setFillColor(color[0], color[1], color[2]);
      doc.rect(x, y, width, height, 'F');
    };
    
    // Helper function to add text with better styling
    const addStyledText = (text: string, x: number, y: number, options: {
      fontSize?: number;
      color?: number[];
      align?: 'left' | 'center' | 'right';
      fontStyle?: 'normal' | 'bold';
      maxWidth?: number;
    } = {}) => {
      const {
        fontSize = 12,
        color = colors.text,
        align = 'left',
        fontStyle = 'normal',
        maxWidth = contentWidth
      } = options;
      
      doc.setFontSize(fontSize);
      doc.setTextColor(color[0], color[1], color[2]);
      doc.setFont('helvetica', fontStyle);
      
      if (align === 'center') {
        doc.text(text, x, y, { align: 'center', maxWidth });
      } else if (align === 'right') {
        doc.text(text, x, y, { align: 'right', maxWidth });
      } else {
        doc.text(text, x, y, { maxWidth });
      }
    };

    // 1. HEADER SECTION with colored background
    addColoredRect(0, 0, pageWidth, 60, colors.light);
    
    // Organization name (large, centered)
    addStyledText(
      data.organization.name, 
      pageWidth / 2, 
      25, 
      { fontSize: 22, fontStyle: 'bold', align: 'center', color: colors.primary }
    );
    
    // Contact info (smaller, centered)
    let yPosition = 35;
    if (data.organization.contactEmail) {
      addStyledText(
        data.organization.contactEmail, 
        pageWidth / 2, 
        yPosition, 
        { fontSize: 9, align: 'center', color: colors.secondary }
      );
      yPosition += 8;
    }
    if (data.organization.website) {
      addStyledText(
        data.organization.website, 
        pageWidth / 2, 
        yPosition, 
        { fontSize: 9, align: 'center', color: colors.secondary }
      );
    }

    // 2. RECEIPT TITLE SECTION
    yPosition = 85;
    addStyledText(
      'THANK YOU FOR YOUR GENEROUS DONATION', 
      pageWidth / 2, 
      yPosition, 
      { fontSize: 12, fontStyle: 'bold', align: 'center', color: colors.primary }
    );
    
    yPosition += 15;
    addStyledText(
      'DONATION RECEIPT', 
      pageWidth / 2, 
      yPosition, 
      { fontSize: 14, fontStyle: 'bold', align: 'center', color: colors.primary }
    );
    
    yPosition += 10;
    addStyledText(
      data.donation.date, 
      pageWidth / 2, 
      yPosition, 
      { fontSize: 10, align: 'center', color: colors.secondary }
    );

    // 3. DONOR DETAILS SECTION
    yPosition += 25;
    
    // Section background
    addColoredRect(margin, yPosition - 5, contentWidth, 35, colors.light);
    
    yPosition += 8;
    addStyledText('DONOR DETAILS', margin + 10, yPosition, { fontSize: 10, fontStyle: 'bold', color: colors.primary });
    
    yPosition += 12;
    addStyledText(`Donor Email: ${data.donor.email}`, margin + 10, yPosition, { fontSize: 10, color: colors.text });
    
    yPosition += 10;
    addStyledText(`Donation Date: ${data.donation.date}`, margin + 10, yPosition, { fontSize: 10, color: colors.text });
    
    if (data.organization.taxId) {
      yPosition += 10;
      addStyledText(`Tax ID (EIN): ${data.organization.taxId}`, margin + 10, yPosition, { fontSize: 10, color: colors.text });
    }

    // 4. AMOUNT SECTION (highlighted)
    yPosition += 30;
    
    // Header row with background
    addColoredRect(margin, yPosition, contentWidth, 20, colors.primary);
    
    addStyledText(
      'DONATION AMOUNT', 
      margin + 10, 
      yPosition + 12, 
      { fontSize: 10, fontStyle: 'bold', color: colors.white }
    );
    
    addStyledText(
      'TOTAL', 
      pageWidth - margin - 10, 
      yPosition + 12, 
      { fontSize: 10, fontStyle: 'bold', color: colors.white, align: 'right' }
    );

    // Amount row
    yPosition += 25;
    addColoredRect(margin, yPosition, contentWidth, 25, colors.light);
    
    addStyledText(
      'Charitable Donation', 
      margin + 10, 
      yPosition + 15, 
      { fontSize: 11, color: colors.text }
    );
    
    addStyledText(
      data.donation.formattedAmount, 
      pageWidth - margin - 10, 
      yPosition + 15, 
      { fontSize: 14, fontStyle: 'bold', color: colors.accent, align: 'right' }
    );

    // Bottom border for amount section
    yPosition += 25;
    addColoredRect(margin, yPosition, contentWidth, 1, colors.primary);

    // 5. CUSTOM MESSAGE (if exists)
    if (data.organization.message && data.organization.message !== 'Thank you for your generous donation!') {
      yPosition += 20;
      addStyledText(
        `"${data.organization.message}"`, 
        pageWidth / 2, 
        yPosition, 
        { fontSize: 11, align: 'center', color: colors.secondary, maxWidth: contentWidth - 40 }
      );
      yPosition += 15;
    }

    // 6. TAX NOTICE SECTION
    yPosition += 20;
    addColoredRect(margin, yPosition, contentWidth, 45, colors.primary);
    
    yPosition += 15;
    addStyledText(
      'This receipt is for your tax records. Please retain for filing purposes.', 
      pageWidth / 2, 
      yPosition, 
      { fontSize: 10, fontStyle: 'bold', align: 'center', color: colors.white, maxWidth: contentWidth - 20 }
    );
    
    yPosition += 15;
    addStyledText(
      'Your generosity makes a difference!', 
      pageWidth / 2, 
      yPosition, 
      { fontSize: 10, fontStyle: 'bold', align: 'center', color: colors.white }
    );

    // 7. FOOTER SECTION
    yPosition = pageHeight - 40;
    
    // Organization info
    addStyledText(
      data.organization.name, 
      pageWidth / 2, 
      yPosition, 
      { fontSize: 10, fontStyle: 'bold', align: 'center', color: colors.text }
    );
    
    yPosition += 10;
    if (data.organization.contactEmail) {
      addStyledText(
        `Questions? Contact us at ${data.organization.contactEmail}`, 
        pageWidth / 2, 
        yPosition, 
        { fontSize: 8, align: 'center', color: colors.secondary }
      );
      yPosition += 8;
    }
    
    if (data.organization.website) {
      addStyledText(
        `Visit our website: ${data.organization.website}`, 
        pageWidth / 2, 
        yPosition, 
        { fontSize: 8, align: 'center', color: colors.secondary }
      );
      yPosition += 8;
    }
    
    // Powered by
    yPosition += 5;
    addStyledText(
      '♥ POWERED BY SHULPAD', 
      pageWidth / 2, 
      yPosition, 
      { fontSize: 7, align: 'center', color: colors.secondary }
    );

    // 8. DECORATIVE ELEMENTS
    // Add subtle corner decorations
    addColoredRect(0, 0, 20, 3, colors.primary);
    addColoredRect(pageWidth - 20, 0, 20, 3, colors.primary);
    addColoredRect(0, pageHeight - 3, 20, 3, colors.primary);
    addColoredRect(pageWidth - 20, pageHeight - 3, 20, 3, colors.primary);
    
    // Convert to buffer
    const pdfArrayBuffer = doc.output('arraybuffer');
    const pdfBuffer = Buffer.from(pdfArrayBuffer);
    
    logger.info(`Styled PDF generated successfully, size: ${pdfBuffer.length} bytes`);
    return pdfBuffer;
    
  } catch (error) {
    logger.error("Error generating styled PDF", { error });
    throw error;
  }
}