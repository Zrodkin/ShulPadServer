// app/api/stripe/cancel/route.ts
import { NextResponse } from "next/server"

export async function GET() {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Subscription Cancelled</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          background-color: #f0f2f5;
        }
        .container {
          text-align: center;
          padding: 40px;
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          max-width: 400px;
          margin: 20px;
        }
        .cancel-icon {
          width: 80px;
          height: 80px;
          margin: 0 auto 20px;
          background-color: #ef4444;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .x-mark {
          width: 40px;
          height: 40px;
          stroke: white;
          stroke-width: 3;
          fill: none;
          stroke-linecap: round;
        }
        h1 {
          color: #1f2937;
          font-size: 24px;
          margin-bottom: 10px;
        }
        p {
          color: #6b7280;
          line-height: 1.5;
          margin-bottom: 30px;
        }
        .button {
          display: inline-block;
          padding: 12px 24px;
          background-color: #6b7280;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="cancel-icon">
          <svg class="x-mark" viewBox="0 0 24 24">
            <path d="M6 6L18 18M6 18L18 6"></path>
          </svg>
        </div>
        <h1>Subscription Cancelled</h1>
        <p>No worries! You can subscribe anytime when you're ready. Your kiosk data will be saved.</p>
        <a href="shulpad://subscription-cancelled" class="button">Return to App</a>
      </div>
      
      <script>
        // Automatically redirect to the app after 2 seconds
        setTimeout(() => {
          window.location.href = "shulpad://subscription-cancelled";
        }, 2000);
        
        // For iOS, also try to close the window
        setTimeout(() => {
          window.close();
        }, 3000);
      </script>
    </body>
    </html>
  `
  
  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html',
    },
  })
}