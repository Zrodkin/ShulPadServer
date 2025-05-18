// src/app/api/square/success/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const success = searchParams.get("success") === "true"
  const error = searchParams.get("error")

  logger.info("Success page accessed", { success, error })

  // Generate HTML that auto-closes the window immediately if successful
  const html = success 
    ? `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Authorized</title>
        <script>
          // Close window immediately
          window.close();
        </script>
      </head>
      <body>
        <!-- Fallback content if window.close() doesn't work -->
        <p>Authorization successful. You can close this window.</p>
      </body>
      </html>
    `
    : `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authorization Failed</title>
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
            color: #F44336;
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
          .error-details {
            font-size: 12px;
            color: #999;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon">❌</div>
          <h1>Authorization Failed</h1>
          <p>There was a problem connecting your Square account. Please try again or contact support.</p>
          ${error ? `<p class="error-details">Error code: ${error}</p>` : ''}
          <p>You can close this window and try again.</p>
        </div>
      </body>
      </html>
    `;

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  });
}