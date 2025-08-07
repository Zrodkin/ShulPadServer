// app/api/square/subscriptions/prepare/route.ts
import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

interface PrepareSubscriptionRequest {
  organization_id: string
  amount: number // Amount in dollars
}

interface SquareError {
  category: string
  code: string
  detail?: string
  field?: string
}

// Cache for plan and variation IDs to reduce API calls
const planCache = new Map<string, { planId: string; timestamp: number }>()
const variationCache = new Map<string, { variationId: string; timestamp: number }>()
const CACHE_TTL = 3600000 // 1 hour in milliseconds

export async function POST(request: NextRequest) {
  try {
    const body: PrepareSubscriptionRequest = await request.json()
    const { organization_id, amount } = body

    // Validate required fields
    if (!organization_id) {
      logger.error("Organization ID is required for subscription preparation")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    if (!amount || amount <= 0) {
      logger.error("Valid amount is required", { amount })
      return NextResponse.json({ error: "Valid amount is required" }, { status: 400 })
    }

    // Get the access token and location_id from the database
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
    
    // Convert amount to cents for Square
    const amountCents = Math.round(amount * 100)
    
    logger.info("Preparing subscription plan variation", { 
      organization_id,
      amount,
      amountCents 
    })

    // Step 1: Get or create the base subscription plan
    let planId = await getOrCreateSubscriptionPlan(
      access_token,
      SQUARE_DOMAIN,
      organization_id
    )

    // Step 2: Get or create the plan variation for this amount
    let variationId = await getOrCreatePlanVariation(
      access_token,
      SQUARE_DOMAIN,
      organization_id,
      planId,
      amountCents
    )

    // Store the plan and variation mapping in database for faster lookup
    try {
      await db.execute(
        `INSERT INTO subscription_plan_mappings 
         (organization_id, amount_cents, plan_id, variation_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, NOW(), NOW())
         ON DUPLICATE KEY UPDATE 
         plan_id = VALUES(plan_id),
         variation_id = VALUES(variation_id),
         updated_at = NOW()`,
        [organization_id, amountCents, planId, variationId]
      )
    } catch (dbError) {
      logger.warn("Failed to cache plan mapping", { error: dbError })
    }

    logger.info("Successfully prepared subscription plan variation", {
      organization_id,
      plan_id: planId,
      variation_id: variationId,
      amount
    })

    return NextResponse.json({
      success: true,
      plan_id: planId,
      plan_variation_id: variationId,
      amount: amount,
      amount_cents: amountCents
    })

  } catch (error: any) {
    logger.error("Error preparing subscription", { error })
    
    // Handle Square API specific errors
    if (error.response?.data?.errors) {
      const squareErrors: SquareError[] = error.response.data.errors
      logger.error("Square API subscription errors", { errors: squareErrors })
      
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
      }, { status: error.response.status })
    }
    
    return NextResponse.json({ 
      error: "Error preparing subscription",
      details: error.message 
    }, { status: 500 })
  }
}

async function getOrCreateSubscriptionPlan(
  accessToken: string,
  squareDomain: string,
  organizationId: string
): Promise<string> {
  const cacheKey = `plan_${organizationId}`
  const cached = planCache.get(cacheKey)
  
  // Check cache first
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.info("Using cached subscription plan", { plan_id: cached.planId })
    return cached.planId
  }

  // Search for existing plan
  try {
    const searchUrl = `https://connect.${squareDomain}/v2/catalog/search`
    const searchResponse = await axios.post(
      searchUrl,
      {
        object_types: ["SUBSCRIPTION_PLAN"],
        query: {
          text_query: {
            keywords: ["Monthly Charitable Donations"]
          }
        }
      },
      {
        headers: {
          "Square-Version": "2025-07-16",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    if (searchResponse.data.objects && searchResponse.data.objects.length > 0) {
      const planId = searchResponse.data.objects[0].id
      logger.info("Found existing subscription plan", { plan_id: planId })
      
      // Update cache
      planCache.set(cacheKey, { planId, timestamp: Date.now() })
      return planId
    }
  } catch (searchError) {
    logger.warn("Error searching for subscription plan, will create new", { error: searchError })
  }

  // Create new subscription plan
  const createUrl = `https://connect.${squareDomain}/v2/catalog/object`
  const createResponse = await axios.post(
    createUrl,
    {
      idempotency_key: uuidv4(),
      object: {
        type: "SUBSCRIPTION_PLAN",
        id: "#monthly-donations-plan",
        subscription_plan_data: {
          name: "Monthly Charitable Donations",
          all_items: false // We're not selling items, just accepting donations
        }
      }
    },
    {
      headers: {
        "Square-Version": "2025-07-16",
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  )

  const planId = createResponse.data.catalog_object.id
  logger.info("Created new subscription plan", { plan_id: planId })
  
  // Update cache
  planCache.set(cacheKey, { planId, timestamp: Date.now() })
  return planId
}

async function getOrCreatePlanVariation(
  accessToken: string,
  squareDomain: string,
  organizationId: string,
  planId: string,
  amountCents: number
): Promise<string> {
  const cacheKey = `variation_${organizationId}_${amountCents}`
  const cached = variationCache.get(cacheKey)
  
  // Check cache first
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    logger.info("Using cached plan variation", { variation_id: cached.variationId })
    return cached.variationId
  }

  // Search for existing variation with this amount
  try {
    const searchUrl = `https://connect.${squareDomain}/v2/catalog/search`
    const searchResponse = await axios.post(
      searchUrl,
      {
        object_types: ["SUBSCRIPTION_PLAN_VARIATION"],
        query: {
          text_query: {
            keywords: [`Monthly $${(amountCents / 100).toFixed(2)}`]
          }
        }
      },
      {
        headers: {
          "Square-Version": "2025-07-16",
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        }
      }
    )

    // Check if we found a variation with matching amount and plan
    if (searchResponse.data.objects && searchResponse.data.objects.length > 0) {
      for (const obj of searchResponse.data.objects) {
        if (obj.subscription_plan_variation_data?.subscription_plan_id === planId) {
          // Verify the amount matches
          const phase = obj.subscription_plan_variation_data.phases?.[0]
          if (phase?.pricing?.price?.amount === amountCents) {
            const variationId = obj.id
            logger.info("Found existing plan variation", { variation_id: variationId })
            
            // Update cache
            variationCache.set(cacheKey, { variationId, timestamp: Date.now() })
            return variationId
          }
        }
      }
    }
  } catch (searchError) {
    logger.warn("Error searching for plan variation, will create new", { error: searchError })
  }

  // Create new plan variation
  const createUrl = `https://connect.${squareDomain}/v2/catalog/object`
  const createResponse = await axios.post(
    createUrl,
    {
      idempotency_key: uuidv4(),
      object: {
        type: "SUBSCRIPTION_PLAN_VARIATION",
        id: `#variation-${amountCents}`,
        subscription_plan_variation_data: {
          name: `Monthly $${(amountCents / 100).toFixed(2)} Donation`,
          phases: [
            {
              cadence: "MONTHLY",
              ordinal: 0,
              // No periods means it continues indefinitely
              pricing: {
                type: "STATIC",
                price: {
                  amount: amountCents,
                  currency: "USD"
                }
              }
            }
          ],
          subscription_plan_id: planId
        }
      }
    },
    {
      headers: {
        "Square-Version": "2025-07-16",
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    }
  )

  const variationId = createResponse.data.catalog_object.id
  logger.info("Created new plan variation", { 
    variation_id: variationId,
    amount_cents: amountCents 
  })
  
  // Update cache
  variationCache.set(cacheKey, { variationId, timestamp: Date.now() })
  return variationId
}