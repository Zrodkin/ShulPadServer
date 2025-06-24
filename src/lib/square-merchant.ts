import axios from "axios"

export async function getMerchantEmail(accessToken: string, merchantId: string): Promise<string | null> {
  try {
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "production"
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    
    console.log("🔍 Fetching merchant details for:", merchantId)
    
    const response = await axios.get(
      `https://connect.${SQUARE_DOMAIN}/v2/merchants/${merchantId}`,
      {
        headers: {
          "Square-Version": "2025-06-18",
          "Authorization": `Bearer ${accessToken}`
        }
      }
    )
    
    const merchant = response.data.merchant
    console.log("📧 Merchant data:", {
      businessName: merchant.business_name,
      status: merchant.status,
      hasMainLocation: !!merchant.main_location_id
    })
    
    // Try to extract email from various places
    let email = null
    
    // Method 1: Check if business name is an email
    if (merchant.business_name && merchant.business_name.includes('@')) {
      email = merchant.business_name
      console.log("📧 Found email in business name:", email)
    }
    
    // Method 2: Try to get from main location (if available)
    if (!email && merchant.main_location_id) {
      try {
        const locationResponse = await axios.get(
          `https://connect.${SQUARE_DOMAIN}/v2/locations/${merchant.main_location_id}`,
          {
            headers: {
              "Square-Version": "2025-06-18",
              "Authorization": `Bearer ${accessToken}`
            }
          }
        )
        
        const location = locationResponse.data.location
        if (location.business_email) {
          email = location.business_email
          console.log("📧 Found email in location data:", email)
        }
      } catch (locationError) {
        console.warn("Could not fetch location details:", locationError)
      }
    }
    
    return email
  } catch (error) {
  console.warn("Could not fetch merchant email:", error)
  return null
}
}