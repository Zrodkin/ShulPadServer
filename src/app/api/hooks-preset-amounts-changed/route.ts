// src/app/api/hooks/preset-amounts-changed/route.ts

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/db";
import { logger } from "@/lib/logger";
import axios from "axios";

// API endpoint to handle preset amounts changes
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { organization_id, preset_amounts } = body;
    
    if (!organization_id) {
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 });
    }
    
    if (!preset_amounts || !Array.isArray(preset_amounts)) {
      return NextResponse.json({ error: "Valid preset amounts array is required" }, { status: 400 });
    }
    
    // Store the new preset amounts in database
    const db = createClient();
    
    try {
      await db.execute(
        `UPDATE kiosk_settings 
         SET preset_amounts = ?,
             updated_at = NOW()
         WHERE organization_id = ?`,
        [preset_amounts, organization_id]
      );
      
      logger.info(`Updated preset amounts for organization ${organization_id}`, {
        count: preset_amounts.length,
        amounts: preset_amounts
      });
      
      // Trigger the catalog sync immediately if API_SECRET is available
      if (process.env.API_SECRET) {
        try {
          // Use internal API call to sync the preset amounts
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
            message: "Preset amounts updated and synchronized with Square catalog",
            sync_result: response.data
          });
        } catch (syncError) {
          logger.error(`Failed to trigger catalog sync for organization ${organization_id}`, { error: syncError });
          
          // Return success for the preset amount update even if sync failed
          return NextResponse.json({
            success: true,
            message: "Preset amounts updated but sync with Square catalog failed",
            sync_pending: true
          });
        }
      }
      
      return NextResponse.json({
        success: true,
        message: "Preset amounts updated. Square catalog sync will happen during the next cron job.",
        sync_pending: true
      });
    } catch (dbError) {
      logger.error(`Database error updating preset amounts for organization ${organization_id}`, { error: dbError });
      return NextResponse.json({ error: "Failed to update preset amounts" }, { status: 500 });
    } 
  } catch (error) {
    logger.error("Error processing preset amounts update", { error });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}