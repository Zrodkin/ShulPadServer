// src/app/api/square/success/route.ts
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

  // Generate HTML with INSTANT redirect (no delays)
  const html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="refresh" content="0;url=${schemeUrl}">
      <title>${success ? "Authorization Successful" : "Authorization Failed"}</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
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
        .spinner {
          border: 4px solid #f3f3f3;
          border-top: 4px solid #4CAF50;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      </style>
      <script>
        // Immediate JavaScript redirect (no delay)
        try {
          console.log('Immediate redirect to: ${schemeUrl}');
          window.location.href = "${schemeUrl}";
        } catch(e) {
          console.error("Immediate redirect failed:", e);
          // Fallback after tiny delay
          setTimeout(function() {
            window.location.href = "${schemeUrl}";
          }, 100);
        }
      </script>
    </head>
    <body>
      <div class="spinner"></div>
      <p>Completing authorization...</p>
    </body>
    </html>
  `

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  })
}