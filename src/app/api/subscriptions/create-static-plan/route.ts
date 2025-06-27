// Add this as a temporary endpoint: /api/subscriptions/create-static-plan
import { NextResponse } from "next/server"
import axios from "axios"

export async function GET() {
  try {
    // Use your Square access token
    const access_token = "EAAAlzqJF9Vbqw4Gdjlqirdc1nlauArJMjgLvoONMyNWKBebaGZoEQFghBEbfI3I"; // Get this from your Square connection
    
    // Create Monthly Static Variation
    const monthlyResponse = await axios.post(
      'https://connect.squareup.com/v2/catalog/object',
      {
        idempotency_key: `static-monthly-${Date.now()}`,
        object: {
          type: "SUBSCRIPTION_PLAN_VARIATION",
          id: "#shulpad-static-monthly",
          subscription_plan_variation_data: {
            name: "ShulPad Monthly - Static",
            phases: [{
              cadence: "MONTHLY",
              ordinal: 0,
              pricing: {
                type: "STATIC",
                price: {
                  amount: 100, // $1.00 - will be overridden
                  currency: "USD"
                }
              }
            }],
            subscription_plan_id: "23CNB7ICQZAAHRLVHTULERSF" // Your plan ID
          }
        }
      },
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    );

    // Create Yearly Static Variation
    const yearlyResponse = await axios.post(
      'https://connect.squareup.com/v2/catalog/object',
      {
        idempotency_key: `static-yearly-${Date.now()}`,
        object: {
          type: "SUBSCRIPTION_PLAN_VARIATION",
          id: "#shulpad-static-yearly",
          subscription_plan_variation_data: {
            name: "ShulPad Yearly - Static",
            phases: [{
              cadence: "ANNUAL",
              ordinal: 0,
              pricing: {
                type: "STATIC",
                price: {
                  amount: 100, // $1.00 - will be overridden
                  currency: "USD"
                }
              }
            }],
            subscription_plan_id: "23CNB7ICQZAAHRLVHTULERSF" // Your plan ID
          }
        }
      },
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${access_token}`,
          "Content-Type": "application/json"
        }
      }
    );

    return NextResponse.json({
      success: true,
      monthly_variation_id: monthlyResponse.data.catalog_object.id,
      yearly_variation_id: yearlyResponse.data.catalog_object.id,
      message: "Save these IDs to your environment variables!"
    });

  } catch (error: any) {
    console.error("Error creating static variations:", error.response?.data || error);
    return NextResponse.json({ 
      error: "Failed to create variations",
      details: error.response?.data 
    }, { status: 500 });
  }
}