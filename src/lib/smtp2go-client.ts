// src/lib/smtp2go-client.ts
import nodemailer from 'nodemailer';
import { logger } from './logger';

// Check for SMTP2GO credentials
if (!process.env.SMTP2GO_USERNAME || !process.env.SMTP2GO_PASSWORD) {
  logger.error("SMTP2GO credentials not set");
  throw new Error("SMTP2GO credentials are required");
}

// Create reusable transporter
const transporter = nodemailer.createTransport({
  host: 'mail.smtp2go.com',
  port: parseInt(process.env.SMTP2GO_PORT || '2525'),
  secure: process.env.SMTP2GO_PORT === '465', // true for SSL
  auth: {
    user: process.env.SMTP2GO_USERNAME,
    pass: process.env.SMTP2GO_PASSWORD
  },
  // Additional options for better reliability
  pool: true,
  maxConnections: 5,
  maxMessages: 100,
  rateLimit: 10, // max 10 messages per second
  logger: process.env.NODE_ENV === 'development',
  debug: process.env.NODE_ENV === 'development'
});

// Verify connection on startup
transporter.verify((error) => {
  if (error) {
    logger.error('SMTP2GO connection failed', { error });
  } else {
    logger.info('SMTP2GO connection established');
  }
});

// Export a compatible interface similar to SES
export const smtp2goClient = {
  async send(command: any): Promise<{ MessageId?: string }> {
    try {
      // Handle both SendEmailCommand and SendRawEmailCommand
      if (command.input?.RawMessage) {
        // Raw email with attachments
        const info = await transporter.sendMail({
          envelope: {
            from: command.input.Source,
            to: command.input.Destinations
          },
          raw: command.input.RawMessage.Data
        });
        
        return { MessageId: info.messageId };
      } else if (command.input?.Message) {
        // Simple email
        const { Source, Destination, Message } = command.input;
        
        const mailOptions = {
          from: Source,
          to: Destination.ToAddresses.join(', '),
          subject: Message.Subject.Data,
          html: Message.Body.Html?.Data,
          text: Message.Body.Text?.Data,
          // Custom headers for tracking (similar to SES Tags)
          headers: command.input.Tags ? 
            Object.fromEntries(command.input.Tags.map((tag: any) => 
              [`X-${tag.Name}`, tag.Value]
            )) : {}
        };
        
        const info = await transporter.sendMail(mailOptions);
        return { MessageId: info.messageId };
      }
      
      throw new Error('Invalid command format');
    } catch (error) {
      throw error;
    }
  }
};

// Error mapping function (compatible with SES error handler)
export function mapSMTP2GOError(error: any): string {
  if (error.code === 'ECONNECTION') {
    return 'Failed to connect to SMTP2GO server';
  }
  if (error.code === 'EAUTH') {
    return 'SMTP2GO authentication failed - check credentials';
  }
  if (error.responseCode === 550) {
    return 'Email was rejected by SMTP2GO - invalid recipient';
  }
  if (error.responseCode === 554) {
    return 'Email content was rejected';
  }
  if (error.response?.includes('rate limit')) {
    return 'SMTP2GO rate limit exceeded';
  }
  if (error.response?.includes('quota')) {
    return 'SMTP2GO sending quota exceeded';
  }
  
  // Generic fallback
  return error.message || 'Unknown SMTP2GO error occurred';
}

// Compatibility wrapper to match SES commands
export class SendEmailCommand {
  input: any;
  constructor(params: any) {
    this.input = params;
  }
}

export class SendRawEmailCommand {
  input: any;
  constructor(params: any) {
    this.input = params;
  }
}