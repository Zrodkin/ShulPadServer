
// src/lib/ses-client.ts
import { SESClient, SendEmailCommand, SendRawEmailCommand } from '@aws-sdk/client-ses';
import { logger } from './logger';

// Initialize SES client with error handling
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  logger.error("AWS credentials not set");
  throw new Error("AWS SES credentials are required");
}

const sesClient = new SESClient({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
});

export { sesClient };

// SES error mapping function
export function mapSESError(error: any): string {
  if (error.name === 'MessageRejected') {
    return 'Email was rejected by Amazon SES';
  }
  if (error.name === 'MailFromDomainNotVerifiedException') {
    return 'Sending domain not verified with Amazon SES';
  }
  if (error.name === 'ConfigurationSetDoesNotExistException') {
    return 'SES configuration set not found';
  }
  if (error.name === 'SendingPausedException') {
    return 'Email sending is paused for this account';
  }
  if (error.name === 'AccountSendingPausedException') {
    return 'Account email sending is paused';
  }
  if (error.name === 'InvalidParameterValue') {
    return 'Invalid email parameters provided';
  }
  
  // Generic fallback
  return error.message || 'Unknown SES error occurred';
}