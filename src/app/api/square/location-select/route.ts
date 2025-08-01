//src/app/api/square/location-select/route.ts

import { type NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/db"
import { logger } from "@/lib/logger"
import { normalizeOrganizationId } from "@/lib/organizationUtils"


interface SquareLocation {
  id: string;
  name: string;
  status: string;
  address?: {
    address_line_1?: string;
    locality?: string;
    administrative_district_level_1?: string;
  };
}



export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const state = searchParams.get("state")
    const success = searchParams.get("success")

    if (!state || success !== "true") {
      logger.error("Invalid location selection request", { state, success })
      return NextResponse.redirect(
        `${request.nextUrl.origin}/api/square/success?success=false&error=invalid_request`
      )
    }

    // Get pending authorization data
    const db = createClient()
   const result = await db.execute(
  "SELECT location_data, merchant_id, organization_id FROM square_pending_tokens WHERE state = ?",
  [state]
)

    if (result.rows.length === 0) {
      logger.error("No pending authorization found for state", { state })
      return NextResponse.redirect(
        `${request.nextUrl.origin}/api/square/success?success=false&error=invalid_state`
      )
    }

const { location_data, merchant_id, organization_id } = result.rows[0]

    if (!location_data) {
      logger.error("No location data found for state", { state })
      return NextResponse.redirect(
        `${request.nextUrl.origin}/api/square/success?success=false&error=no_location_data`
      )
    }

    const locations: SquareLocation[] = JSON.parse(location_data)
    logger.info("Displaying location selection", { merchant_id, locations_count: locations.length })

    // Generate location selection HTML
const html = generateLocationSelectionHTML(locations, state, merchant_id, organization_id)

    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html",
      },
    })
  } catch (error) {
    logger.error("Error in location selection GET", { error })
    return NextResponse.redirect(
      `${request.nextUrl.origin}/api/square/success?success=false&error=server_error`
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
  const { state, location_id, organization_id: orgIdFromBody } = body;

    logger.info("Processing location selection", { state, location_id, orgIdFromBody })

    if (!state || !location_id) {
      logger.error("Missing required parameters", { state, location_id })
      return NextResponse.json({ error: "Missing required parameters" }, { status: 400 })
    }

    const db = createClient()
    
    // Get the pending authorization data
const pendingResult = await db.execute(
  `SELECT access_token, refresh_token, merchant_id, location_data, expires_at, device_id, organization_id 
   FROM square_pending_tokens WHERE state = ?`,
  [state]
)

    if (pendingResult.rows.length === 0) {
      logger.error("No pending authorization found", { state })
      return NextResponse.json({ error: "Invalid state" }, { status: 400 })
    }

const { access_token, refresh_token, merchant_id, location_data, expires_at, device_id, organization_id: orgIdFromDb } = pendingResult.rows[0]

    
    if (!location_data) {
      logger.error("No location data in pending tokens", { state })
      return NextResponse.json({ error: "No location data available" }, { status: 400 })
    }

    const locations: SquareLocation[] = JSON.parse(location_data)
    
    // Validate the selected location
    const selectedLocation = locations.find(loc => loc.id === location_id)
    if (!selectedLocation) {
      logger.error("Invalid location selection", { location_id, available_locations: locations.map(l => l.id) })
      return NextResponse.json({ error: "Invalid location selection" }, { status: 400 })
    }

   logger.info("Valid location selected", { 
  location_id, 
  location_name: selectedLocation.name,
  merchant_id,
  rawOrganizationId: orgIdFromBody,
  normalizedOrganizationId: orgIdFromDb  // Use orgIdFromDb instead
})

    // Begin transaction - FIXED: Use START TRANSACTION instead of BEGIN
    await db.execute("START TRANSACTION")

    try {
      // Store in permanent connections table with selected location
const normalizedOrgId = orgIdFromDb; 

      // Store in permanent connections table with selected location - FIXED: Use VALUES instead of EXCLUDED
  await db.execute(
  `INSERT INTO square_connections (
    organization_id, 
    merchant_id,
    location_id,
    access_token, 
    refresh_token, 
    expires_at,
    device_id,  // ADD THIS
    created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
  ON DUPLICATE KEY UPDATE
    merchant_id = VALUES(merchant_id),
    location_id = VALUES(location_id),
    access_token = VALUES(access_token),
    refresh_token = VALUES(refresh_token),
    expires_at = VALUES(expires_at),
    device_id = VALUES(device_id),  // ADD THIS
    updated_at = NOW()`,
  [normalizedOrgId, merchant_id, location_id, access_token, refresh_token, expires_at, device_id]  // ADD device_id
)

      await db.execute(
  `UPDATE square_pending_tokens SET
    access_token = ?, 
    refresh_token = ?, 
    merchant_id = ?,
    location_id = ?,
    expires_at = ?
  WHERE state = ?`,
  [access_token, refresh_token, merchant_id, location_id, expires_at, state]
)

      await db.execute("COMMIT")

     logger.info("Location selection completed successfully", { 
  rawOrganizationId: orgIdFromBody,
  normalizedOrganizationId: normalizedOrgId,
  merchant_id, 
  location_id,
  location_name: selectedLocation.name 
})

      // Return success with location info for mobile app
     return NextResponse.json({ 
  success: true, 
  location_name: selectedLocation.name,
  location_id: location_id,
  merchant_id: merchant_id,
  redirect_url: `shulpad://oauth-complete?success=true&merchant_id=${encodeURIComponent(merchant_id)}&location_id=${encodeURIComponent(location_id)}&location_name=${encodeURIComponent(selectedLocation.name)}`,
  message: "Location selected successfully"
})

    } catch (dbError) {
      await db.execute("ROLLBACK")
      logger.error("Database error during location selection", { error: dbError })
      return NextResponse.json({ error: "Database error" }, { status: 500 })
    }

  } catch (error) {
    logger.error("Error processing location selection", { error })
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

function generateLocationSelectionHTML(locations: SquareLocation[], state: string, merchantId: string, organizationId: string): string {  const locationOptions = locations
    .filter(loc => loc.status === "ACTIVE")
    .map(loc => {
      const address = loc.address 
        ? `${loc.address.address_line_1 || ''}, ${loc.address.locality || ''}, ${loc.address.administrative_district_level_1 || ''}`.replace(/^,\s*|,\s*$/g, '')
        : ''
      
      return `
        <div class="location-option" onclick="selectLocation('${loc.id}')">
          <div class="location-name">${loc.name}</div>
          ${address ? `<div class="location-address">${address}</div>` : ''}
        </div>
      `
    }).join('')

  // Build the script separately to avoid template literal conflicts
  const script = `
    let selectedLocationId = null;
    
    function selectLocation(locationId) {
      document.querySelectorAll('.location-option').forEach(el => {
        el.classList.remove('selected');
      });
      
      event.target.closest('.location-option').classList.add('selected');
      selectedLocationId = locationId;
      document.getElementById('continueBtn').disabled = false;
    }
    
    async function confirmSelection() {
      if (!selectedLocationId) return;
      
      document.querySelector('.container').style.display = 'none';
      document.getElementById('loading').style.display = 'block';
      
      try {
        const response = await fetch('/api/square/location-select', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            state: '${state}',
            location_id: selectedLocationId,
            organization_id: '${organizationId}'
          })
        });
        
        const result = await response.json();
        
        if (result.success) {
          console.log('Location selected successfully:', result);
          
          const redirectUrl = result.redirect_url;
          
          const metaTag = document.createElement('meta');
          metaTag.httpEquiv = 'refresh';
          metaTag.content = '0;url=' + redirectUrl;
          document.head.appendChild(metaTag);
          
          setTimeout(() => {
            try {
              window.location.href = redirectUrl;
            } catch(e) {
              console.error('Redirect failed:', e);
              document.getElementById('loading').innerHTML = 
                '<p>Almost done! <a href="' + redirectUrl + '">Click here to return to ShulPad</a></p>';
            }
          }, 500);
          
        } else {
          alert('Error: ' + (result.error || 'Unknown error'));
          location.reload();
        }
      } catch (error) {
        console.error('Network error:', error);
        alert('Network error. Please try again.');
        location.reload();
      }
    }
  `.replace('${state}', state); // Replace the placeholder with actual state

  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Select Location - ShulPad</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          margin: 0;
          padding: 20px;
          background: #f7f7f7;
        }
        .container {
          background: white;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
        }
        h1 { color: #333; margin-bottom: 10px; }
        .subtitle { color: #666; margin-bottom: 30px; }
        .location-option {
          border: 2px solid #e0e0e0;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .location-option:hover {
          border-color: #4CAF50;
          background: #f8fff8;
        }
        .location-option.selected {
          border-color: #4CAF50;
          background: #e8f5e8;
        }
        .location-name {
          font-weight: 600;
          color: #333;
          margin-bottom: 4px;
        }
        .location-address {
          font-size: 14px;
          color: #666;
        }
        .continue-btn {
          width: 100%;
          background: #4CAF50;
          color: white;
          border: none;
          padding: 14px;
          border-radius: 6px;
          font-size: 16px;
          font-weight: 600;
          margin-top: 20px;
          cursor: pointer;
          opacity: 0.5;
          transition: opacity 0.2s;
        }
        .continue-btn:enabled {
          opacity: 1;
        }
        .continue-btn:enabled:hover {
          background: #45a049;
        }
        .loading {
          display: none;
          text-align: center;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Select Your Location</h1>
        <p class="subtitle">Choose which Square location you want to use with ShulPad:</p>
        
        <div class="locations">
          ${locationOptions}
        </div>
        
        <button class="continue-btn" id="continueBtn" onclick="confirmSelection()" disabled>
          Continue
        </button>
        
        <div class="loading" id="loading">
          <p>Setting up your location...</p>
        </div>
      </div>

      <script>${script}</script>
    </body>
    </html>
  `
}