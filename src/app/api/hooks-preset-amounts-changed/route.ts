// src/app/api/hooks/preset-amounts-changed/route.ts

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import axios from "axios";

// API endpoint to handle kiosk settings changes (preset amounts and processing fees)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      organization_id, 
      preset_amounts,
      processing_fee_enabled,
      processing_fee_percentage,
      processing_fee_fixed_cents
    } = body;
    
    if (!organization_id) {
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 });
    }
    
    // Store the settings in database
    const db = createClient();
    
    try {
      // First, ensure the organization has a row in kiosk_settings
      await db.execute(
        `INSERT INTO kiosk_settings (
          organization_id, 
          preset_amounts,
          processing_fee_enabled,
          processing_fee_percentage,
          processing_fee_fixed_cents,
          created_at, 
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE 
          preset_amounts = IF(? IS NOT NULL, ?, preset_amounts),
          processing_fee_enabled = IF(? IS NOT NULL, ?, processing_fee_enabled),
          processing_fee_percentage = IF(? IS NOT NULL, ?, processing_fee_percentage),
          processing_fee_fixed_cents = IF(? IS NOT NULL, ?, processing_fee_fixed_cents),
          updated_at = NOW()`,
        [
          // INSERT values
          organization_id,
          preset_amounts ? JSON.stringify(preset_amounts) : null,
          processing_fee_enabled !== undefined ? (processing_fee_enabled ? 1 : 0) : null,
          processing_fee_percentage ?? null,
          processing_fee_fixed_cents ?? null,
          // UPDATE conditions - only update if value was provided
          preset_amounts ? 1 : null,
          preset_amounts ? JSON.stringify(preset_amounts) : null,
          processing_fee_enabled !== undefined ? 1 : null,
          processing_fee_enabled !== undefined ? (processing_fee_enabled ? 1 : 0) : null,
          processing_fee_percentage !== undefined ? 1 : null,
          processing_fee_percentage ?? null,
          processing_fee_fixed_cents !== undefined ? 1 : null,
          processing_fee_fixed_cents ?? null
        ]
      );
      
      logger.info(`Updated kiosk settings for organization ${organization_id}`, {
        preset_amounts: preset_amounts?.length,
        processing_fee_enabled,
        processing_fee_percentage,
        processing_fee_fixed_cents
      });
      
      // Trigger catalog sync if preset amounts were updated and API_SECRET is available
      if (preset_amounts && process.env.API_SECRET) {
        try {
          const response = await axios.post(
            `${process.env.VERCEL_URL || 'http://localhost:3000'}/api/square/catalog/sync-preset-amounts`,
            { organization_id },
            {
              headers: {
                'Authorization': `Bearer ${process.env.API_SECRET}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          logger.info(`Successfully triggered catalog sync for organization ${organization_id}`, {
            sync_result: response.data
          });
          
          return NextResponse.json({
            success: true,
            message: "Settings updated and synchronized with Square catalog",
            sync_result: response.data
          });
        } catch (syncError) {
          logger.error(`Failed to trigger catalog sync for organization ${organization_id}`, { error: syncError });
          
          return NextResponse.json({
            success: true,
            message: "Settings updated but Square catalog sync failed",
            sync_pending: true
          });
        }
      }
      
      return NextResponse.json({
        success: true,
        message: "Settings updated successfully",
        sync_pending: preset_amounts ? true : false
      });
      
    } catch (dbError) {
      logger.error(`Database error updating settings for organization ${organization_id}`, { error: dbError });
      return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
    }
    
  } catch (error) {
    logger.error("Error processing settings update", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}