// app/api/square/subscriptions/create/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

interface CreateSubscriptionRequest {
  organization_id: string
  payment_id: string // From the successful payment just processed
  customer_id: string // From create-or-get customer endpoint
  plan_variation_id: string // From prepare endpoint
  location_id: string // Location where subscription is created
  card_id?: string // Optional if already have card on file
  start_date?: string // Optional custom start date (defaults to next month)
  end_date?: string 
  total_months?: number
}

interface SquareError {
  category: string
  code: string
  detail?: string
  field?: string
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateSubscriptionRequest = await request.json()
    const { 
      organization_id,
      payment_id,
      customer_id,
      plan_variation_id,
      location_id,
      card_id,
      start_date,
      end_date,
      total_months 
    } = body

    // Validate required fields
    if (!organization_id) {
      logger.error("Organization ID is required for subscription creation")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    if (!payment_id) {
      logger.error("Payment ID is required for subscription creation")
      return NextResponse.json({ error: "Payment ID is required" }, { status: 400 })
    }

    if (!customer_id) {
      logger.error("Customer ID is required for subscription creation")
      return NextResponse.json({ error: "Customer ID is required" }, { status: 400 })
    }

    if (!plan_variation_id) {
      logger.error("Plan variation ID is required for subscription creation")
      return NextResponse.json({ error: "Plan variation ID is required" }, { status: 400 })
    }

    if (!location_id) {
      logger.error("Location ID is required for subscription creation")
      return NextResponse.json({ error: "Location ID is required" }, { status: 400 })
    }

    // Validate end date if provided
if (end_date) {
  const endDateObj = new Date(end_date)
  const startDateObj = new Date(start_date || new Date())
  
  if (endDateObj <= startDateObj) {
    logger.error("End date must be after start date", { 
      start_date: start_date || "today",
      end_date 
    })
    return NextResponse.json({ 
      error: "End date must be after start date" 
    }, { status: 400 })
  }
  
  // Optional: Limit to maximum 3 years
  const maxEndDate = new Date(startDateObj)
  maxEndDate.setFullYear(maxEndDate.getFullYear() + 3)
  
  if (endDateObj > maxEndDate) {
    logger.error("End date too far in future", { end_date })
    return NextResponse.json({ 
      error: "End date cannot be more than 3 years in the future" 
    }, { status: 400 })
  }
}

    // Get the access token from the database
    const db = createClient()
    const result = await db.execute(
      "SELECT access_token FROM square_connections WHERE organization_id = ?",
      [organization_id]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { access_token } = result.rows[0]
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    
    logger.info("Creating subscription", { 
      organization_id,
      customer_id,
      payment_id,
      plan_variation_id
    })

    let finalCardId = card_id

    // Step 1: If no card_id provided, create card on file from the payment
    if (!finalCardId) {
      try {
        logger.info("Creating card on file from payment", { payment_id })
        
        const cardUrl = `https://connect.${SQUARE_DOMAIN}/v2/cards`
        const cardResponse = await axios.post(
          cardUrl,
          {
            idempotency_key: uuidv4(),
            source_id: payment_id,
            card: {
              customer_id: customer_id
            }
          },
          {
            headers: {
              "Square-Version": "2025-07-16",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )

        finalCardId = cardResponse.data.card.id
        logger.info("Created card on file", { 
          card_id: finalCardId,
          last_4: cardResponse.data.card.last_4 
        })

      } catch (cardError: any) {
        logger.error("Error creating card on file", { error: cardError })
        
        if (cardError.response?.data?.errors) {
          const squareErrors: SquareError[] = cardError.response.data.errors
          
          // Check if it's because card already exists
          const isDuplicate = squareErrors.some(err => 
            err.code === 'CARD_ALREADY_EXISTS' || 
            err.code === 'DUPLICATE_CARD'
          )
          
          if (isDuplicate) {
            // Try to list cards for customer and use the first one
            try {
              const listCardsUrl = `https://connect.${SQUARE_DOMAIN}/v2/cards?customer_id=${customer_id}`
              const listResponse = await axios.get(listCardsUrl, {
                headers: {
                  "Square-Version": "2025-07-16",
                  "Authorization": `Bearer ${access_token}`,
                  "Content-Type": "application/json"
                }
              })
              
              if (listResponse.data.cards && listResponse.data.cards.length > 0) {
                finalCardId = listResponse.data.cards[0].id
                logger.info("Using existing card on file", { card_id: finalCardId })
              }
            } catch (listError) {
              logger.error("Error listing cards", { error: listError })
            }
          }
          
          if (!finalCardId) {
            return NextResponse.json({ 
              error: "Failed to create card on file",
              square_errors: squareErrors
            }, { status: cardError.response.status })
          }
        } else {
          throw cardError
        }
      }
    }

    // Step 2: Calculate start date (first day of next month if not specified)
    let subscriptionStartDate = start_date
    if (!subscriptionStartDate) {
      const now = new Date()
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      subscriptionStartDate = nextMonth.toISOString().split('T')[0] // YYYY-MM-DD format
    }

    // Step 3: Create the subscription
    try {
      const subscriptionUrl = `https://connect.${SQUARE_DOMAIN}/v2/subscriptions`
      
      const subscriptionData: {
        idempotency_key: string
        location_id: string
        customer_id: string
        plan_variation_id: string
        card_id: string | undefined
        start_date: string
        source: { name: string }
        phases?: Array<{ ordinal: number; periods: number }>
      } = {
        idempotency_key: uuidv4(),
        location_id: location_id,
        customer_id: customer_id,
        plan_variation_id: plan_variation_id,
        card_id: finalCardId,
        start_date: subscriptionStartDate,
        source: {
          name: "Charity Kiosk Monthly Donation"
        }
      }

// Add phases if end date is specified
if (end_date) {
  // Calculate number of periods more accurately
  const startDate = new Date(subscriptionStartDate)
  const endDate = new Date(end_date)
  
  // Calculate the difference in months
  let monthsDiff = (endDate.getFullYear() - startDate.getFullYear()) * 12
  monthsDiff += endDate.getMonth() - startDate.getMonth()
  
  // Add 1 to include the start month
  monthsDiff = Math.max(1, monthsDiff + 1)
  
  subscriptionData.phases = [
    {
      ordinal: 0,
      periods: monthsDiff  // This will automatically end the subscription after X months
    }
  ]
  
  logger.info("Creating subscription with end date", {
    start_date: subscriptionStartDate,
    end_date,
    total_periods: monthsDiff
  })
}

      logger.info("Creating subscription with data", subscriptionData)

      const subscriptionResponse = await axios.post(
        subscriptionUrl,
        subscriptionData,
        {
          headers: {
            "Square-Version": "2025-07-16",
            "Authorization": `Bearer ${access_token}`,
            "Content-Type": "application/json"
          }
        }
      )

      const subscription = subscriptionResponse.data.subscription
      
      logger.info("Successfully created subscription", {
        subscription_id: subscription.id,
        status: subscription.status,
        start_date: subscription.start_date,
        customer_id: subscription.customer_id
      })

    // Step 4: Store subscription record in database
try {
  await db.execute(
    `INSERT INTO donor_subscriptions 
     (organization_id, square_subscription_id, square_customer_id, 
      square_card_id, plan_variation_id, payment_id, 
      status, start_date, planned_end_date, total_planned_months, 
      created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
    [
      organization_id,
      subscription.id,
      customer_id,
      finalCardId,
      plan_variation_id,
      payment_id,
      subscription.status,
      subscription.start_date,
      end_date || null,
      total_months || null
    ]
  )
} catch (dbError) {
  logger.warn("Failed to store subscription record", { error: dbError })
}

      // Step 5: Get the subscription invoice schedule for the response
      let nextBillingDate = null
      try {
        if (subscription.invoice_ids && subscription.invoice_ids.length > 0) {
          // Get the first invoice to show next billing date
          const invoiceUrl = `https://connect.${SQUARE_DOMAIN}/v2/invoices/${subscription.invoice_ids[0]}`
          const invoiceResponse = await axios.get(invoiceUrl, {
            headers: {
              "Square-Version": "2025-07-16",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          })
          
          nextBillingDate = invoiceResponse.data.invoice.scheduled_at
        }
      } catch (invoiceError) {
        logger.warn("Could not fetch invoice details", { error: invoiceError })
        nextBillingDate = subscription.start_date // Fallback to start date
      }

      return NextResponse.json({
        success: true,
        subscription_id: subscription.id,
        customer_id: subscription.customer_id,
        status: subscription.status,
        start_date: subscription.start_date,
        next_billing_date: nextBillingDate || subscription.start_date,
         end_date: end_date || null,
  total_months: total_months || null,
        card_id: finalCardId,
        plan_variation_id: subscription.plan_variation_id,
        message: "Monthly donation subscription created successfully"
      })

    } catch (subscriptionError: any) {
      logger.error("Error creating subscription", { error: subscriptionError })
      
      if (subscriptionError.response?.data?.errors) {
        const squareErrors: SquareError[] = subscriptionError.response.data.errors
        logger.error("Square API subscription creation errors", { errors: squareErrors })
        
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
        }, { status: subscriptionError.response.status })
      }
      
      throw subscriptionError
    }

  } catch (error: any) {
    logger.error("Error in subscription creation", { error })
    
    return NextResponse.json({ 
      error: "Error creating subscription",
      details: error.message 
    }, { status: 500 })
  }
}