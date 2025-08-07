// app/api/square/customers/create-or-get/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

interface CreateOrGetCustomerRequest {
  organization_id: string
  email: string
  given_name?: string
  family_name?: string
  phone_number?: string
  reference_id?: string // Optional reference to link to your internal donor ID
  note?: string // Optional note about the donor
}

interface SquareCustomer {
  id: string
  given_name?: string
  family_name?: string
  email_address?: string
  phone_number?: string
  reference_id?: string
  note?: string
  created_at: string
  updated_at: string
}

interface SquareError {
  category: string
  code: string
  detail?: string
  field?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateOrGetCustomerRequest = await request.json()
    const { 
      organization_id, 
      email,
      given_name,
      family_name,
      phone_number,
      reference_id,
      note
    } = body

    // Validate required fields
    if (!organization_id) {
      logger.error("Organization ID is required for customer operations")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    if (!email) {
      logger.error("Email is required for customer creation")
      return NextResponse.json({ error: "Email is required" }, { status: 400 })
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      logger.error("Invalid email format", { email })
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
    }

    // Get the access token from the database
    const db = createClient()
    const result = await db.execute(
      "SELECT access_token, location_id FROM square_connections WHERE organization_id = ?",
      [organization_id]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token, location_id } = result.rows[0]
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    
    logger.info("Creating or retrieving customer", { 
      organization_id,
      email,
      has_name: !!(given_name || family_name)
    })

    // Step 1: Search for existing customer by email
    let customerId: string | null = null
    let existingCustomer: SquareCustomer | null = null

    try {
      const searchUrl = `https://connect.${SQUARE_DOMAIN}/v2/customers/search`
      const searchResponse = await axios.post(
        searchUrl,
        {
          filter: {
            email_address: {
              exact: email
            }
          },
          limit: 1
        },
        {
          headers: {
            "Square-Version": "2025-07-16",
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json"
          }
        }
      )

      if (searchResponse.data.customers && searchResponse.data.customers.length > 0) {
        existingCustomer = searchResponse.data.customers[0]
        customerId = existingCustomer.id
        logger.info("Found existing customer", { 
          customer_id: customerId,
          email: existingCustomer.email_address 
        })
      }
    } catch (searchError) {
      logger.warn("Error searching for customer, will create new", { error: searchError })
    }

    // Step 2: Create new customer if not found
    if (!customerId) {
      try {
        const createUrl = `https://connect.${SQUARE_DOMAIN}/v2/customers`
        
        // Build customer data
        const customerData: any = {
          email_address: email,
          idempotency_key: uuidv4()
        }

        // Add optional fields if provided
        if (given_name) customerData.given_name = given_name
        if (family_name) customerData.family_name = family_name
        if (phone_number) customerData.phone_number = phone_number
        if (reference_id) customerData.reference_id = reference_id
        
        // Add note combining donation context with any provided note
        const donationNote = "Monthly donation subscriber"
        customerData.note = note ? `${donationNote} - ${note}` : donationNote

        const createResponse = await axios.post(
          createUrl,
          customerData,
          {
            headers: {
              "Square-Version": "2025-07-16",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )

        const newCustomer = createResponse.data.customer
        customerId = newCustomer.id
        
        logger.info("Created new customer", { 
          customer_id: customerId,
          email: newCustomer.email_address 
        })

        // Store in database for tracking
        try {
          await db.execute(
            `INSERT INTO donor_customers 
             (organization_id, square_customer_id, email, given_name, family_name, 
              phone_number, reference_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
             ON DUPLICATE KEY UPDATE 
             square_customer_id = VALUES(square_customer_id),
             updated_at = NOW()`,
            [
              organization_id,
              customerId,
              email,
              given_name || null,
              family_name || null,
              phone_number || null,
              reference_id || null
            ]
          )
        } catch (dbError) {
          logger.warn("Failed to store customer record", { error: dbError })
        }

        return NextResponse.json({
          success: true,
          customer_id: customerId,
          email: newCustomer.email_address,
          given_name: newCustomer.given_name,
          family_name: newCustomer.family_name,
          created: true,
          message: "New customer created"
        })

      } catch (createError: any) {
        logger.error("Error creating customer", { error: createError })
        
        // Handle Square API specific errors
        if (createError.response?.data?.errors) {
          const squareErrors: SquareError[] = createError.response.data.errors
          logger.error("Square API customer creation errors", { errors: squareErrors })
          
          const firstError = squareErrors[0]
          return NextResponse.json({ 
            error: firstError.detail || firstError.code,
            square_error: {
              category: firstError.category,
              code: firstError.code,
              detail: firstError.detail,
              field: firstError.field
            },
            square_errors: squareErrors
          }, { status: createError.response.status })
        }
        
        throw createError
      }
    }

    // Step 3: Update existing customer if needed
    if (existingCustomer && (given_name || family_name || phone_number)) {
      // Check if update is needed
      const needsUpdate = 
        (given_name && given_name !== existingCustomer.given_name) ||
        (family_name && family_name !== existingCustomer.family_name) ||
        (phone_number && phone_number !== existingCustomer.phone_number)

      if (needsUpdate) {
        try {
          const updateUrl = `https://connect.${SQUARE_DOMAIN}/v2/customers/${customerId}`
          
          const updateData: any = {}
          if (given_name && given_name !== existingCustomer.given_name) {
            updateData.given_name = given_name
          }
          if (family_name && family_name !== existingCustomer.family_name) {
            updateData.family_name = family_name
          }
          if (phone_number && phone_number !== existingCustomer.phone_number) {
            updateData.phone_number = phone_number
          }

          const updateResponse = await axios.put(
            updateUrl,
            updateData,
            {
              headers: {
                "Square-Version": "2025-07-16",
                "Authorization": `Bearer ${access_token}`,
                "Content-Type": "application/json"
              }
            }
          )

          logger.info("Updated existing customer", { 
            customer_id: customerId,
            updated_fields: Object.keys(updateData)
          })

          existingCustomer = updateResponse.data.customer
        } catch (updateError) {
          logger.warn("Failed to update customer, continuing with existing", { error: updateError })
        }
      }
    }

    // Store/update in database for tracking
    try {
      await db.execute(
        `INSERT INTO donor_customers 
         (organization_id, square_customer_id, email, given_name, family_name, 
          phone_number, reference_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE 
         square_customer_id = VALUES(square_customer_id),
         given_name = VALUES(given_name),
         family_name = VALUES(family_name),
         phone_number = VALUES(phone_number),
         updated_at = NOW()`,
        [
          organization_id,
          customerId,
          email,
          given_name || existingCustomer?.given_name || null,
          family_name || existingCustomer?.family_name || null,
          phone_number || existingCustomer?.phone_number || null,
          reference_id || existingCustomer?.reference_id || null
        ]
      )
    } catch (dbError) {
      logger.warn("Failed to store/update customer record", { error: dbError })
    }

    return NextResponse.json({
      success: true,
      customer_id: customerId,
      email: existingCustomer?.email_address || email,
      given_name: existingCustomer?.given_name || given_name,
      family_name: existingCustomer?.family_name || family_name,
      created: false,
      message: "Existing customer retrieved"
    })

  } catch (error: any) {
    logger.error("Error in customer create-or-get", { error })
    
    return NextResponse.json({ 
      error: "Error processing customer",
      details: error.message 
    }, { status: 500 })
  }
}