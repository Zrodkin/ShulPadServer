import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // In a production environment, you should verify the webhook signature
    // using Square's signature verification process
    
    if (body.type === 'oauth.authorization.revoked') {
      // Handle revocation - update your database, notify the app, etc.
      console.log('OAuth authorization revoked for merchant:', body.merchant_id);
      
      // In a real implementation, you would:
      // 1. Update your database to mark this merchant as disconnected
      // 2. Potentially notify the iOS app if it's currently being used
    }
    
    return NextResponse.json({ received: true });
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json(
      { error: 'Failed to process webhook' },
      { status: 500 }
    );
  }
}
