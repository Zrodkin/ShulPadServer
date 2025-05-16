// /api/square/callback/route.ts
import { type NextRequest, NextResponse } from "next/server"
import axios from "axios"
import { createClient } from "@/lib/db"

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const code = searchParams.get("code")
    const state = searchParams.get("state")
    
    // Log all parameters to help with debugging
    console.log("Received callback with params:", Object.fromEntries(searchParams.entries()))

    if (!code) {
      console.error("No authorization code received")
      return NextResponse.json({ error: "Authorization code is missing" }, { status: 400 })
    }

    const SQUARE_APP_ID = process.env.SQUARE_APP_ID
    const SQUARE_APP_SECRET = process.env.SQUARE_APP_SECRET
    const REDIRECT_URI = process.env.REDIRECT_URI || "https://charity-pad-server.vercel.app/api/square/callback"
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || "sandbox"

    if (!SQUARE_APP_ID || !SQUARE_APP_SECRET) {
      console.error("Missing environment variables")
      return NextResponse.json({ error: "Missing required environment variables" }, { status: 500 })
    }

    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === "production" ? "squareup.com" : "squareupsandbox.com"
    const SQUARE_TOKEN_URL = `https://connect.${SQUARE_DOMAIN}/oauth2/token`

    console.log("Exchanging code for tokens...")
    
    // Exchange the authorization code for access token
    const response = await axios.post(
      SQUARE_TOKEN_URL,
      {
        client_id: SQUARE_APP_ID,
        client_secret: SQUARE_APP_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      },
    )

    const data = response.data

    if (data.error) {
      console.error("Token exchange error:", data)
      return NextResponse.json({ error: data.error }, { status: 400 })
    }

    console.log("Successfully obtained tokens for merchant:", data.merchant_id)

    // Extract tokens and merchant info
    const { access_token, refresh_token, expires_at, merchant_id } = data

    // Store tokens in database (optional - already implemented in your code)
    try {
      const db = createClient()
      // Your existing code to store tokens...
    } catch (dbError) {
      console.error("Database error storing tokens:", dbError)
    }

    // Prepare response data for status endpoint
    // Store this information securely so status endpoint can access it
    try {
      // Create a temporary token storage with expiration
      const db = createClient()
      await db.query(
        `INSERT INTO square_pending_tokens (
          state,
          access_token, 
          refresh_token, 
          merchant_id,
          expires_at,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          state,
          access_token,
          refresh_token,
          merchant_id,
          expires_at
        ]
      )
    } catch (storageError) {
      console.error("Error storing pending tokens:", storageError)
    }

    // Return success page that will close the browser window
    return new Response(`
      <html>
        <head>
          <title>Connection Successful</title>
          <script>
            window.onload = function() {
              // Display success message
              document.getElementById('status').innerText = 'Successfully connected to Square!';
              // Close the window automatically after a few seconds
              setTimeout(function() {
                window.close();
              }, 3000);
            }
          </script>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              text-align: center;
            }
            .container {
              padding: 20px;
              border-radius: 8px;
              box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
              max-width: 400px;
            }
            h1 {
              color: #4CAF50;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Square Connection</h1>
            <p id="status">Completing connection...</p>
            <p>You can close this window and return to the app.</p>
          </div>
        </body>
      </html>
    `, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  } catch (error) {
    console.error("Server error:", error)
    return NextResponse.json({ error: "Server error during token exchange" }, { status: 500 })
  }
}