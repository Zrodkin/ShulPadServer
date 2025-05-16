import { NextResponse, type NextRequest } from "next/server"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
const searchParams = request.nextUrl.searchParams
const success = searchParams.get("success") === "true"
const error = searchParams.get("error")

logger.info("Success page accessed", { success, error })

// Generate a simple HTML success page
const html = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
        margin-bottom: 20px;
      }
      p {
        color: #666;
        line-height: 1.6;
        margin-bottom: 30px;
      }
      .icon {
        font-size: 64px;
        margin-bottom: 20px;
      }
      .logo {
        margin-bottom: 30px;
        max-width: 200px;
      }
      .error-details {
        font-size: 12px;
        color: #999;
        margin-top: 20px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <img src="/images/charity-pad-logo.png" alt="CharityPad Logo" class="logo">
      <div class="icon">${success ? "✅" : "❌"}</div>
      <h1>${success ? "Authorization Successful" : "Authorization Failed"}</h1>
      <p>${
        success
          ? "Your Square account has been successfully connected to CharityPad. You can now close this window and return to the app."
          : "There was a problem connecting your Square account. Please try again or contact support."
      }</p>
      ${error ? `<p class="error-details">Error code: ${error}</p>` : ''}
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
