import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

export async function GET() {
  try {
    const SQUARE_APP_ID = process.env.SQUARE_APP_ID;
    const REDIRECT_URI = process.env.REDIRECT_URI;
    const SQUARE_ENVIRONMENT = process.env.SQUARE_ENVIRONMENT || 'sandbox';
    
    if (!SQUARE_APP_ID || !REDIRECT_URI) {
      return NextResponse.json(
        { error: 'Missing required environment variables' },
        { status: 500 }
      );
    }
    
    const SQUARE_DOMAIN = SQUARE_ENVIRONMENT === 'production' 
      ? 'squareup.com' 
      : 'squareupsandbox.com';
    
    const scopes = [
      'MERCHANT_PROFILE_READ',
      'PAYMENTS_WRITE',
      'PAYMENTS_WRITE_IN_PERSON',
      'PAYMENTS_READ'
    ];
    
    const state = uuidv4();
    
    const authUrl = `https://connect.${SQUARE_DOMAIN}/oauth2/authorize?` +
      `client_id=${SQUARE_APP_ID}` +
      `&scope=${scopes.join('+')}` +
      `&state=${state}` +
      `&redirect_uri=${REDIRECT_URI}`;
    
    return NextResponse.json({ authUrl, state });
  } catch (error) {
    console.error('Error generating auth URL:', error);
    return NextResponse.json(
      { error: 'Failed to generate authorization URL' },
      { status: 500 }
    );
  }
}
