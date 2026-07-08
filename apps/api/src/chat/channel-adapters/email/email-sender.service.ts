import {
  BadGatewayException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type {
  ChannelOutboundMessage,
  ChannelOutboundSendResult,
  ChannelOutboundSender,
} from '../outbound-sender.types';
import { EmailConfigService } from './email-config.service';
import { MAILER_TRANSPORT_FACTORY } from './mailer-transport';
import type { MailerTransportFactory } from './mailer-transport.types';

/** Default `subject` used when the caller does not supply one. */
const DEFAULT_SUBJECT = 'Notification from Nexus Orchestrator';

/**
 * Sends outbound chat messages over email (invitation delivery). Mirrors
 * {@link TelegramSenderService}'s message-shape extension pattern by adding
 * an optional `subject` field on top of {@link ChannelOutboundMessage}.
 *
 * The message body (`text`) may contain a sensitive invite token/link, so it
 * is never logged; only the recipient's domain is logged on failure.
 */
@Injectable()
export class EmailSenderService implements ChannelOutboundSender {
  private readonly logger = new Logger(EmailSenderService.name);

  constructor(
    private readonly emailConfig: EmailConfigService,
    @Inject(MAILER_TRANSPORT_FACTORY)
    private readonly transportFactory: MailerTransportFactory,
  ) {}

  async sendMessage(
    message: ChannelOutboundMessage & { subject?: string },
  ): Promise<ChannelOutboundSendResult> {
    const settings = await this.emailConfig.resolveSmtpSettings();
    if (!settings) {
      throw new BadGatewayException('SMTP is not configured');
    }

    const transport = this.transportFactory({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      ...(settings.auth ? { auth: settings.auth } : {}),
    });

    try {
      const info = await transport.sendMail({
        from: settings.from,
        to: message.externalThreadId,
        subject: message.subject ?? DEFAULT_SUBJECT,
        text: message.text,
      });

      return { providerMessageId: info.messageId ?? null };
    } catch (error) {
      this.logger.warn(
        `Email send failed for recipient domain ${this.redactRecipientDomain(message.externalThreadId)}`,
      );
      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new BadGatewayException(`Email send failed: ${reason}`);
    }
  }

  /** Logs only the recipient's domain — never the full address or body. */
  private redactRecipientDomain(externalThreadId: string): string {
    const atIndex = externalThreadId.indexOf('@');
    return atIndex === -1 ? '(unknown)' : externalThreadId.slice(atIndex + 1);
  }
}
