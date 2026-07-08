import { createTransport } from 'nodemailer';

import type {
  MailerTransport,
  MailerTransportFactory,
  SmtpTransportOptions,
} from './mailer-transport.types';

/**
 * DI token for the {@link MailerTransportFactory} that produces the
 * SMTP transport used by {@link EmailSenderService} (Task 4). Consumers
 * inject a fake factory in tests to avoid opening real SMTP connections.
 */
export const MAILER_TRANSPORT_FACTORY = Symbol('MAILER_TRANSPORT_FACTORY');

/**
 * Real provider: wraps `nodemailer.createTransport` behind the
 * {@link MailerTransportFactory} seam so it can be swapped for a fake
 * in unit tests.
 */
export function createNodemailerTransportFactory(): MailerTransportFactory {
  return (options: SmtpTransportOptions): MailerTransport =>
    createTransport(options);
}
