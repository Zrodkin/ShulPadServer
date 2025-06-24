// scripts/create-square-plans.js
// ONE-TIME SETUP: Create generic Square subscription plans with $1 placeholder pricing
const axios = require("axios")
const dotenv = require('dotenv')

dotenv.config({ path: '.env.local' })

async function createSquarePlans() {
  const SQUARE_ACCESS_TOKEN = process.env.SQUARE_ACCESS_TOKEN
  const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
  const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
  
  if (!SQUARE_ACCESS_TOKEN) {
    console.error("❌ SQUARE_ACCESS_TOKEN not found")
    return
  }
  
  console.log("🎯 Creating generic Square subscription plans (as per original plan)...")
  
  try {
    // 1. Create Monthly Plan with $1 placeholder
    console.log("📅 Creating Monthly Plan...")
    const monthlyPlanResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/catalog/object`,
      {
        type: "SUBSCRIPTION_PLAN",
        id: "#monthly_plan",
        subscription_plan_data: {
          name: "ShulPad Monthly",
          subscription_plan_variations: [
            {
              id: "#monthly_variation",
              name: "Monthly Base",
              phases: [
                {
                  cadence: "MONTHLY",
                  recurring_price_money: { 
                    amount: 100,  // $1.00 placeholder
                    currency: "USD" 
                  }
                }
              ]
            }
          ]
        }
      },
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    )
    
    const monthlyPlan = monthlyPlanResponse.data.catalog_object
    const monthlyVariationId = monthlyPlan.subscription_plan_data.subscription_plan_variations[0].id
    console.log("✅ Monthly Plan Created:")
    console.log(`   Plan ID: ${monthlyPlan.id}`)
    console.log(`   Variation ID: ${monthlyVariationId}`)
    
    // 2. Create Yearly Plan with $1 placeholder
    console.log("📅 Creating Yearly Plan...")
    const yearlyPlanResponse = await axios.post(
      `https://connect.${SQUARE_DOMAIN}/v2/catalog/object`,
      {
        type: "SUBSCRIPTION_PLAN",
        id: "#yearly_plan",
        subscription_plan_data: {
          name: "ShulPad Yearly",
          subscription_plan_variations: [
            {
              id: "#yearly_variation",
              name: "Yearly Base",
              phases: [
                {
                  cadence: "ANNUAL",
                  recurring_price_money: { 
                    amount: 100,  // $1.00 placeholder
                    currency: "USD" 
                  }
                }
              ]
            }
          ]
        }
      },
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    )
    
    const yearlyPlan = yearlyPlanResponse.data.catalog_object
    const yearlyVariationId = yearlyPlan.subscription_plan_data.subscription_plan_variations[0].id
    console.log("✅ Yearly Plan Created:")
    console.log(`   Plan ID: ${yearlyPlan.id}`)
    console.log(`   Variation ID: ${yearlyVariationId}`)
    
    // 3. Output environment variables to add
    console.log("\n🔧 ADD THESE TO YOUR .env.local:")
    console.log(`SQUARE_MONTHLY_PLAN_VARIATION_ID=${monthlyVariationId}`)
    console.log(`SQUARE_YEARLY_PLAN_VARIATION_ID=${yearlyVariationId}`)
    
    console.log("\n🎉 Generic plans created successfully!")
    console.log("💡 Now you can use price_override_money for dynamic pricing!")
    
  } catch (error) {
    console.error("❌ Error creating plans:", error.response?.data || error.message)
  }
}

createSquarePlans()