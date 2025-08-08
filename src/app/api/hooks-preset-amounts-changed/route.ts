// src/app/api/hooks-preset-amounts-changed/route.ts

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
    
    logger.info("Received kiosk settings update request", {
      organization_id,
      preset_amounts_count: preset_amounts?.length,
      processing_fee_enabled,
      processing_fee_percentage,
      processing_fee_fixed_cents
    });
    
    if (!organization_id) {
      logger.error("Missing organization_id in request");
      return NextResponse.json({ error: "Organization ID is required" }, { status: 400 });
    }
    
    // Store the settings in database
    const db = createClient();
    
    try {
      // Build the SQL query with proper handling of undefined values
      const insertValues = [];
      const updateConditions = [];
      const updateValues = [];
      
      // Always include organization_id for INSERT
      insertValues.push(organization_id);
      
      // Handle preset_amounts
      if (preset_amounts !== undefined && preset_amounts !== null) {
        insertValues.push(JSON.stringify(preset_amounts));
        updateConditions.push("preset_amounts = ?");
        updateValues.push(JSON.stringify(preset_amounts));
      } else {
        insertValues.push(null);
      }
      
      // Handle processing_fee_enabled
      if (processing_fee_enabled !== undefined && processing_fee_enabled !== null) {
        insertValues.push(processing_fee_enabled ? 1 : 0);
        updateConditions.push("processing_fee_enabled = ?");
        updateValues.push(processing_fee_enabled ? 1 : 0);
      } else {
        insertValues.push(null);
      }
      
      // Handle processing_fee_percentage
      if (processing_fee_percentage !== undefined && processing_fee_percentage !== null) {
        insertValues.push(processing_fee_percentage);
        updateConditions.push("processing_fee_percentage = ?");
        updateValues.push(processing_fee_percentage);
      } else {
        insertValues.push(null);
      }
      
      // Handle processing_fee_fixed_cents - FIXED: Now using correct value
      if (processing_fee_fixed_cents !== undefined && processing_fee_fixed_cents !== null) {
        insertValues.push(processing_fee_fixed_cents);
        updateConditions.push("processing_fee_fixed_cents = ?");
        updateValues.push(processing_fee_fixed_cents); // ✅ FIXED: Using processing_fee_fixed_cents
      } else {
        insertValues.push(null);
      }
      
      // Add timestamps
      insertValues.push('NOW()', 'NOW()'); // These will be handled by MySQL
      
      // Build the complete query
      let query = `
        INSERT INTO kiosk_settings (
          organization_id, 
          preset_amounts,
          processing_fee_enabled,
          processing_fee_percentage,
          processing_fee_fixed_cents,
          created_at, 
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, NOW(), NOW())
      `;
      
      if (updateConditions.length > 0) {
        query += ` ON DUPLICATE KEY UPDATE ${updateConditions.join(", ")}, updated_at = NOW()`;
      } else {
        query += ` ON DUPLICATE KEY UPDATE updated_at = NOW()`;
      }
      
      // Execute the query
      const allValues = [...insertValues.slice(0, -2), ...updateValues]; // Remove the NOW() placeholders
      
      logger.info("Executing SQL query", {
        query: query.replace(/\s+/g, ' ').trim(),
        values_count: allValues.length,
        organization_id
      });
      
      await db.execute(query, allValues);
      
      logger.info(`✅ Successfully updated kiosk settings for organization ${organization_id}`, {
        preset_amounts: preset_amounts?.length,
        processing_fee_enabled,
        processing_fee_percentage,
        processing_fee_fixed_cents
      });
      
      // Trigger catalog sync if preset amounts were updated and API_SECRET is available
      if (preset_amounts && process.env.API_SECRET) {
        try {
          const baseUrl = process.env.VERCEL_URL 
            ? `https://${process.env.VERCEL_URL}` 
            : 'http://localhost:3000';
            
          const response = await axios.post(
            `${baseUrl}/api/square/catalog/sync-preset-amounts`,
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
            sync_result: response.data,
            settings_updated: {
              preset_amounts: preset_amounts?.length,
              processing_fee_enabled,
              processing_fee_percentage,
              processing_fee_fixed_cents
            }
          });
        } catch (syncError) {
          logger.error(`Failed to trigger catalog sync for organization ${organization_id}`, { error: syncError });
          
          return NextResponse.json({
            success: true,
            message: "Settings updated but Square catalog sync failed",
            sync_pending: true,
            settings_updated: {
              preset_amounts: preset_amounts?.length,
              processing_fee_enabled,
              processing_fee_percentage,
              processing_fee_fixed_cents
            }
          });
        }
      }
      
      return NextResponse.json({
        success: true,
        message: "Settings updated successfully",
        sync_pending: preset_amounts ? true : false,
        settings_updated: {
          preset_amounts: preset_amounts?.length,
          processing_fee_enabled,
          processing_fee_percentage,
          processing_fee_fixed_cents
        }
      });
      
    } catch (dbError: any) {
      logger.error(`Database error updating settings for organization ${organization_id}`, { 
        error: dbError,
        message: dbError.message,
        code: dbError.code
      });
      
      // Return more detailed error information
      return NextResponse.json({ 
        success: false,
        error: "Failed to update settings",
        details: dbError.message,
        code: dbError.code
      }, { status: 500 });
    }
    
  } catch (error: any) {
    logger.error("Error processing settings update", { 
      error,
      message: error.message 
    });
    
    return NextResponse.json({ 
      success: false,
      error: "Internal server error",
      details: error.message
    }, { status: 500 });
  }
}