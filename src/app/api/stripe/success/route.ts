// app/api/stripe/success/route.ts
import { NextResponse } from "next/server"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sessionId = searchParams.get('session_id')
  
  // Create an HTML page that will communicate back to the iOS app
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Subscription Successful!</title>
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
        .success-icon {
          width: 80px;
          height: 80px;
          margin: 0 auto 20px;
          background-color: #10b981;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .checkmark {
          width: 40px;
          height: 40px;
          stroke: white;
          stroke-width: 3;
          fill: none;
          stroke-linecap: round;
          stroke-linejoin: round;
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
          background-color: #3b82f6;
          color: white;
          text-decoration: none;
          border-radius: 8px;
          font-weight: 600;
          transition: background-color 0.2s;
        }
        .button:hover {
          background-color: #2563eb;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">
          <svg class="checkmark" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <h1>Welcome to ShulPad!</h1>
        <p>Your subscription is now active with a 30-day free trial. You can close this window and return to the app to start using the kiosk.</p>
        <a href="shulpad://subscription-success${sessionId ? `?session_id=${sessionId}` : ''}" class="button">Return to App</a>
      </div>
      
      <script>
        // Automatically redirect to the app after 2 seconds
        setTimeout(() => {
          window.location.href = "shulpad://subscription-success${sessionId ? `?session_id=${sessionId}` : ''}";
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