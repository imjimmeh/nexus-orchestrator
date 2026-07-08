export interface SmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  auth?: { user: string; pass: string };
}

export interface MailPayload {
  from: string;
  to: string;
  subject: string;
  text: string;
}

export interface MailerSendResult {
  messageId?: string;
}

export interface MailerTransport {
  sendMail(payload: MailPayload): Promise<MailerSendResult>;
}

export type MailerTransportFactory = (
  options: SmtpTransportOptions,
) => MailerTransport;
