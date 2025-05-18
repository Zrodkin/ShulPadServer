import { NextResponse, type NextRequest } from "next/server"
import { logger } from "@/lib/logger"

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const success = searchParams.get("success") === "true"
  const error = searchParams.get("error")

  logger.info("Success page accessed", { success, error })

  // Generate HTML that attempts to close immediately
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
      ${success ? `
      <script>
        // Try multiple methods to close the window immediately
        function attemptClose() {
          try {
            window.close();
            setTimeout(function() {
              // If we're still here after 100ms, try again with different methods
              try { window.open('', '_self').close(); } catch(e) {}
              try { window.parent.close(); } catch(e) {}
            }, 100);
          } catch(e) {}
        }
        
        // Try to close immediately
        attemptClose();
        
        // Try again after a tiny delay (browsers sometimes need this)
        setTimeout(attemptClose, 50);
        
        // And again after another tiny delay
        setTimeout(attemptClose, 100);
        
        // Setup click handler on document to help with closing
        document.addEventListener('DOMContentLoaded', function() {
          document.body.addEventListener('click', attemptClose);
          // Auto-click to trigger user interaction
          setTimeout(function() {
            try {
              document.body.click();
            } catch(e) {}
          }, 150);
        });
      </script>
      ` : ''}
    </head>
    <body>
      ${success ? `
        <!-- Hidden success message, as we're trying to close instantly -->
        <div class="card" style="display: none;">
          <h1>Authorization Successful</h1>
          <p>Your account has been connected successfully.</p>
          <button onclick="window.close()">Close Window</button>
          <p class="close-msg">Please close this window if it doesn't close automatically.</p>
        </div>
        <script>
          // Show the card after a delay only if auto-close failed
          setTimeout(function() {
            document.querySelector('.card').style.display = 'block';
          }, 300);
        </script>
      ` : `
        <div class="card">
          <h1>Authorization Failed</h1>
          <p>There was a problem connecting your account. Please try again.</p>
          ${error ? `<p class="close-msg">Error: ${error}</p>` : ''}
          <button onclick="window.close()">Close Window</button>
        </div>
      `}
    </body>
    </html>
  `

  return new NextResponse(html, {
    headers: {
      "Content-Type": "text/html",
    },
  })
}