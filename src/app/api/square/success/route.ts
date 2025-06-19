// src/app/api/square/success/route.ts - IMPROVED VERSION
import { NextResponse, type NextRequest } from "next/server"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const success = searchParams.get("success") === "true"
  const error = searchParams.get("error")
  const merchantId = searchParams.get("merchant_id")
  const locationId = searchParams.get("location_id")
  const locationName = searchParams.get("location_name")

  logger.info("Success page accessed", { success, error, merchantId, locationId, locationName })

  // Build the custom URL scheme redirect with all parameters
  let schemeUrl = `shulpad://oauth-complete?success=${success}`
  
  if (success && merchantId) {
    schemeUrl += `&merchant_id=${encodeURIComponent(merchantId)}`
  }
  if (success && locationId) {
    schemeUrl += `&location_id=${encodeURIComponent(locationId)}`
  }
  if (success && locationName) {
    schemeUrl += `&location_name=${encodeURIComponent(locationName)}`
  }
  if (!success && error) {
    schemeUrl += `&error=${encodeURIComponent(error)}`
  }

  logger.info("Redirecting to app with URL", { schemeUrl })

  // Generate HTML with META REFRESH (most reliable method)
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="1;url=${schemeUrl}">
      <title>${success ? "Authorization Successful" : "Authorization Failed"}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          margin: 0;
          padding: 20px;
          text-align: center;
          background-color: #f7f7f7;
        }
        .card {
          background: white;
          border-radius: 12px;
          padding: 40px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
          max-width: 500px;
          width: 100%;
        }
        h1 {
          color: ${success ? "#4CAF50" : "#F44336"};
          margin-bottom: 16px;
        }
        p {
          color: #666;
          margin-bottom: 12px;
        }
        .spinner {
          border: 4px solid #f3f3f3;
          border-top: 4px solid ${success ? "#4CAF50" : "#F44336"};
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
          margin: 20px auto;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        .manual-link {
          display: inline-block;
          margin-top: 20px;
          color: #4CAF50;
          text-decoration: none;
          font-weight: 500;
          padding: 10px 20px;
          border: 2px solid #4CAF50;
          border-radius: 6px;
          transition: all 0.2s;
        }
        .manual-link:hover {
          background-color: #4CAF50;
          color: white;
        }
        .debug-info {
          margin-top: 20px;
          font-size: 12px;
          color: #999;
          word-break: break-all;
        }
      </style>
      <script>
        // JavaScript fallback (backup to meta refresh)
        setTimeout(function() {
          try {
            console.log('Attempting JavaScript redirect to: ${schemeUrl}');
            window.location.href = "${schemeUrl}";
          } catch(e) {
            console.error("JavaScript redirect failed:", e);
          }
        }, 1500);
        
        // Manual redirect function
        function manualRedirect() {
          try {
            window.location.href = "${schemeUrl}";
          } catch(e) {
            alert("Unable to redirect automatically. Please return to the app manually.");
          }
        }
      </script>
    </head>
    <body>
      <div class="card">
        <h1>${success ? "✅ Authorization Successful" : "❌ Authorization Failed"}</h1>
        
        ${success 
          ? `<p>Your Square account has been connected successfully!</p>
             ${locationName ? `<p><strong>Location:</strong> ${locationName}</p>` : ''}` 
          : `<p>There was a problem connecting your account.</p>
             ${error ? `<p><strong>Error:</strong> ${error}</p>` : ''}`
        }
        
        <div class="spinner"></div>
        <p>Returning to ShulPad...</p>
        
        <!-- Manual fallback link -->
        <a href="${schemeUrl}" class="manual-link" onclick="manualRedirect(); return false;">
          Return to App Manually
        </a>
        
        <!-- Debug info (remove in production) -->
        <div class="debug-info">
          Debug: ${schemeUrl}
        </div>
      </div>
    </body>
    </html>
  `

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  })
}