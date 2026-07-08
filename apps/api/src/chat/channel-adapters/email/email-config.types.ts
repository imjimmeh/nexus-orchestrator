import type { SmtpTransportOptions } from './mailer-transport.types';

/**
 * Resolved SMTP connection settings for the invitation-email sender
 * (Task 4). Extends {@link SmtpTransportOptions} (host/port/secure/auth)
 * with the envelope `from` address so callers don't need a second config
 * lookup, and so the transport shape stays defined in one place.
 */
export interface ResolvedSmtpSettings extends SmtpTransportOptions {
  from: string;
}
