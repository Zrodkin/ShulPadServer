// src/app/api/square/orders/create/route.ts - COMPLETE FIX

import { NextResponse, type NextRequest } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { v4 as uuidv4 } from "uuid"

interface LineItem {
  catalogObjectId?: string;
  quantity?: string;
  basePriceMoney?: {
    amount: number;
    currency?: string;
  };
  name?: string;
}

interface ProcessingFeeConfig {
  enabled: boolean;
  percentage: number;  // e.g., 2.6 for 2.6%
  fixed_cents: number; // e.g., 15 for 15¢
}

// Define the ServiceCharge type based on Square's API
interface ServiceCharge {
  name: string;
  amount_money: {
    amount: number;
    currency: string;
  };
  calculation_phase: string;
  taxable: boolean;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { 
      organization_id, 
      line_items, 
      customer_id = null,
      reference_id = null,
      state = "OPEN",
      idempotency_key = uuidv4(),
      // NEW: Custom amount support
      is_custom_amount = false,
      custom_amount = null,
    } = body

    logger.info("Order creation request", { 
      organization_id, 
      is_custom_amount, 
      custom_amount,
      has_line_items: !!line_items 
    })

    if (!organization_id) {
      logger.error("Organization ID is required for order creation")
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 })
    }

    // Get the access token, location_id AND processing fee settings from the database
    const db = createClient()
    const result = await db.execute(
      `SELECT sc.access_token, sc.location_id, 
              ks.processing_fee_enabled, ks.processing_fee_percentage, ks.processing_fee_fixed_cents
       FROM square_connections sc
       LEFT JOIN kiosk_settings ks ON sc.organization_id = ks.organization_id
       WHERE sc.organization_id = ?`,
      [organization_id]
    )

    if (result.rows.length === 0) {
      logger.error("No Square connection found for this organization", { organization_id })
      return NextResponse.json({ error: "Not connected to Square" }, { status: 404 })
    }

    const { 
      access_token, 
      location_id,
      processing_fee_enabled = false,
      processing_fee_percentage = 2.6,
      processing_fee_fixed_cents = 15
    } = result.rows[0]
    
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_ORDERS_URL = `https://connect.${SQUARE_DOMAIN}/v2/orders`

    let processedLineItems: any[] = []
    // Fix: Properly type serviceCharges as an array of ServiceCharge or undefined
    let serviceCharges: ServiceCharge[] | undefined = undefined;

    // Handle custom amounts - these always need service charges if fees are enabled
    if (is_custom_amount && custom_amount && custom_amount > 0) {
      logger.info("Processing custom amount order", { custom_amount })
      
      // For custom amounts, we need to add processing fee as service charge
      if (processing_fee_enabled) {
        const amountCents = Math.round(custom_amount * 100);
        const percentageFee = Math.round(amountCents * processing_fee_percentage / 100);
        const totalFee = percentageFee + processing_fee_fixed_cents;
        
        serviceCharges = [{
          name: "Processing Fee",
          amount_money: {
            amount: totalFee,
            currency: "USD"
          },
          calculation_phase: "SUBTOTAL_PHASE",
          taxable: false
        }];
        
        logger.info("Added processing fee for custom amount", {
          custom_amount,
          fee: totalFee / 100
        });
      }
      
      // Method 1: Try to use existing "Custom Amount" variation
      try {
        // First, find the existing Custom Amount variation
        const catalogResponse = await axios.get(
          `https://connect.${SQUARE_DOMAIN}/v2/catalog/list?types=ITEM_VARIATION`,
          {
            headers: {
              "Square-Version": "2025-05-21",
              "Authorization": `Bearer ${access_token}`,
              "Content-Type": "application/json"
            }
          }
        )

        // Look for the Custom Amount variation with VARIABLE_PRICING
        const customAmountVariation = catalogResponse.data.objects?.find((obj: any) => 
          obj.type === "ITEM_VARIATION" && 
          obj.item_variation_data?.name === "Custom Amount" &&
          obj.item_variation_data?.pricing_type === "VARIABLE_PRICING"
        )

        if (customAmountVariation) {
          // SUCCESS: Use existing Custom Amount variation with price override
          processedLineItems.push({
            quantity: "1",
            catalog_object_id: customAmountVariation.id,
            // This is the key: override the price for variable pricing
            base_price_money: {
              amount: Math.round(custom_amount * 100), // Convert to cents
              currency: "USD"
            },
            // Optional: Add a note to identify this as a custom amount
            note: `Custom donation amount: $${custom_amount}`
          })
          
          logger.info("Using existing Custom Amount variation", { 
            variation_id: customAmountVariation.id,
            amount: custom_amount,
            amount_cents: Math.round(custom_amount * 100)
          })
        } else {
          throw new Error("Custom Amount variation not found in catalog")
        }
      } catch (catalogError) {
        logger.warn("Could not use Custom Amount variation, creating ad-hoc item", { 
          error: catalogError instanceof Error ? catalogError.message : catalogError 
        })
        
        // Method 2: Fallback to ad-hoc line item
        processedLineItems.push({
          quantity: "1",
          name: `Custom Donation - $${custom_amount}`,
          base_price_money: {
            amount: Math.round(custom_amount * 100),
            currency: "USD"
          },
          note: "Custom donation amount"
        })
        
        logger.info("Created ad-hoc custom amount item", { 
          amount: custom_amount,
          amount_cents: Math.round(custom_amount * 100)
        })
      }
    } else if (line_items && Array.isArray(line_items) && line_items.length > 0) {
      // Handle preset amounts
      logger.info("Processing preset amount order", { line_items_count: line_items.length })
      
      // IMPORTANT: For preset amounts with catalog items, the fee is already included
      // in the catalog variation price, so we DON'T add service charges
      
      // Validate line items
      for (const item of line_items as LineItem[]) {
        if (!item.catalogObjectId && (!item.basePriceMoney || !item.basePriceMoney.amount || !item.name)) {
          logger.error("Invalid line item", { item })
          return NextResponse.json({ 
            error: "Each line item must have either catalogObjectId or both basePriceMoney and name" 
          }, { status: 400 })
        }
        
        if (!item.quantity) {
          item.quantity = "1";
        }
      }

      // Process regular line items
      processedLineItems = line_items.map((item: LineItem) => {
        const lineItem: any = {
          quantity: item.quantity || "1"
        }

        if (item.catalogObjectId) {
          // Preset donation - reference catalog item
          // The catalog item already has the fee-inclusive price if fees are enabled
          lineItem.catalog_object_id = item.catalogObjectId
          logger.debug("Using catalog item (fee already included if enabled)", { 
            catalog_id: item.catalogObjectId 
          })
        } else {
          // Ad-hoc line item (shouldn't happen for presets but handle it)
          lineItem.name = item.name || "Donation"
          lineItem.base_price_money = {
            amount: item.basePriceMoney!.amount,
            currency: item.basePriceMoney!.currency || "USD"
          }
          
          // If this is an ad-hoc item and fees are enabled, add service charge
          if (processing_fee_enabled && !serviceCharges) {
            const amountCents = item.basePriceMoney!.amount;
            const percentageFee = Math.round(amountCents * processing_fee_percentage / 100);
            const totalFee = percentageFee + processing_fee_fixed_cents;
            
            serviceCharges = [{
              name: "Processing Fee",
              amount_money: {
                amount: totalFee,
                currency: "USD"
              },
              calculation_phase: "SUBTOTAL_PHASE",
              taxable: false
            }];
          }
          
          logger.debug("Using ad-hoc item", { name: lineItem.name, amount: lineItem.base_price_money.amount })
        }

        return lineItem
      })
    } else {
      // No valid line items provided
      logger.error("No valid line items or custom amount provided")
      return NextResponse.json({ 
        error: "Either line_items or custom_amount must be provided" 
      }, { status: 400 })
    }

    // Create the order request
    const orderRequest = {
      idempotency_key,
      order: {
        location_id: location_id,
        line_items: processedLineItems,
        state: state,
        ...(serviceCharges && { service_charges: serviceCharges }),
        ...(customer_id && { customer_id }),
        ...(reference_id && { reference_id })
      }
    }

    logger.info("Creating Square order", { 
      organization_id,
      line_items_count: processedLineItems.length,
      has_service_charges: !!serviceCharges,
      is_custom_amount,
      custom_amount,
      state,
      location_id
    })

    // Make the request to Square API
    const response = await axios.post(
      SQUARE_ORDERS_URL,
      orderRequest,
      {
        headers: {
          "Square-Version": "2025-05-21",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    )

    const order = response.data.order

    logger.info("Successfully created order", { 
      organization_id,
      order_id: order?.id,
      total_money: order?.totalMoney,
      state: order?.state,
      line_items_created: order?.lineItems?.length,
      service_charges: order?.serviceCharges?.length
    })

       try {
      await db.execute(
        `INSERT INTO kiosk_settings (organization_id, processing_fee_enabled, processing_fee_percentage, processing_fee_fixed_cents)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE 
           processing_fee_enabled = VALUES(processing_fee_enabled),
           processing_fee_percentage = VALUES(processing_fee_percentage),
           processing_fee_fixed_cents = VALUES(processing_fee_fixed_cents),
           updated_at = NOW()`,
        [organization_id, processing_fee_enabled ? 1 : 0, processing_fee_percentage, processing_fee_fixed_cents]
      )
      logger.info("Updated kiosk settings with processing fee configuration", { 
        organization_id, 
        processing_fee_enabled 
      })
    } catch (settingsError) {
      // Don't fail the order if settings update fails
      logger.error("Failed to update kiosk settings", { error: settingsError })
    }

    // Return formatted response
    return NextResponse.json({
      success: true,
      order_id: order?.id,
      state: order?.state,
      total_money: order?.totalMoney,
      line_items: order?.lineItems?.map((item: any) => ({
        uid: item.uid,
        name: item.name,
        quantity: item.quantity,
        total_money: item.totalMoney,
        catalog_object_id: item.catalogObjectId || null,
        base_price_money: item.basePriceMoney,
        is_custom_amount: is_custom_amount && custom_amount > 0
      })),
      service_charges: order?.serviceCharges?.map((charge: any) => ({
        uid: charge.uid,
        name: charge.name,
        amount_money: charge.amountMoney,
        total_money: charge.totalMoney
      })),
      location_id: order?.locationId,
      created_at: order?.createdAt,
      updated_at: order?.updatedAt
    })

  } catch (error: any) {
    logger.error("Error creating order", { error: error.message || error })
    
    // Handle Square API specific errors
    if (error.response?.data?.errors) {
      const squareErrors = error.response.data.errors
      logger.error("Square API errors", { errors: squareErrors })
      
      const firstError = squareErrors[0]
      return NextResponse.json({ 
        success: false,
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
      success: false,
      error: "Error creating order",
      details: error.message 
    }, { status: 500 })
  }
}