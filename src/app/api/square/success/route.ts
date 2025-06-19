// src/app/api/square/success/route.ts
import { NextResponse, type NextRequest } from "next/server"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const success = searchParams.get("success") === "true"
  const error = searchParams.get("error")

  logger.info("Success page accessed", { success, error })

  // Generate HTML that communicates back to the app using URL scheme
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
        }
        p {
          color: #666;
        }
        .close-msg {
          margin-top: 20px;
          font-size: 14px;
          color: #999;
        }
        button {
          background-color: #4CAF50;
          color: white;
          border: none;
          padding: 10px 20px;
          margin-top: 10px;
          cursor: pointer;
          border-radius: 4px;
        }
      </style>
      <script>
        // Function to handle redirection and closing
        function redirectToApp() {
          // First, try to use the custom URL scheme to signal the app
          try {
            // Using ShulPad:// scheme to signal completion to the app
            // The path "oauth-complete" will be caught by the app
            window.location.href = "shulPad://oauth-complete?success=${success}${error ? '&error=' + encodeURIComponent(error) : ''}";
            
            // If we're still here after 300ms, try window.close
            setTimeout(function() {
              try { 
                window.close(); 
              } catch(e) {}
            }, 300);
          } catch(e) {
            // Fallback if redirection fails
            console.error("Error redirecting to app:", e);
          }
        }
        
        // Try to redirect as soon as page loads
        document.addEventListener('DOMContentLoaded', function() {
          // Show message briefly before attempting redirect
          setTimeout(redirectToApp, 500);
          
          // Also attach to button click and body click
          document.body.addEventListener('click', redirectToApp);
          if (document.getElementById('closeButton')) {
            document.getElementById('closeButton').addEventListener('click', redirectToApp);
          }
        });
      </script>
    </head>
    <body>
      <div class="card">
        <h1>${success ? "Authorization Successful" : "Authorization Failed"}</h1>
        <p>${success ? "Your account has been connected successfully." : "There was a problem connecting your account."}</p>
        ${error ? `<p class="close-msg">Error: ${error}</p>` : ''}
        <button id="closeButton">Return to App</button>
        <p class="close-msg">Click the button above to return to the app.</p>
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