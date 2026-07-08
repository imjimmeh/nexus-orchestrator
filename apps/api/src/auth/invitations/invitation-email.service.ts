import { Injectable, Logger } from '@nestjs/common';
import { EmailConfigService } from '../../chat/channel-adapters/email/email-config.service';
import { EmailSenderService } from '../../chat/channel-adapters/email/email-sender.service';
import type {
  InvitationDeliveryResult,
  InvitationEmailRequest,
  InvitationMailer,
} from './invitation-mailer.types';

/** Subject line for every outbound invitation email. */
const INVITE_SUBJECT = 'You have been invited to Nexus Orchestrator';

/**
 * {@link InvitationMailer} implementation composing
 * {@link EmailConfigService.buildAcceptInviteLink} (Task 4) with
 * {@link EmailSenderService.sendMessage} (Task 5) to deliver an invitation's
 * accept link by email.
 *
 * Delivery is deliberately best-effort from the caller's point of view: an
 * invitation is valid and acceptable via its link regardless of whether the
 * notification email goes out, so this NEVER throws — it always resolves to
 * an {@link InvitationDeliveryResult} describing what happened, and
 * `InvitationService` (Task 9) treats a non-delivered result as non-fatal.
 *
 * The raw token and the accept link (which embeds it) are never logged;
 * only the caught error message is, on a send failure.
 */
@Injectable()
export class InvitationEmailService implements InvitationMailer {
  private readonly logger = new Logger(InvitationEmailService.name);

  constructor(
    private readonly emailConfig: EmailConfigService,
    private readonly emailSender: EmailSenderService,
  ) {}

  async sendInvitationEmail(
    request: InvitationEmailRequest,
  ): Promise<InvitationDeliveryResult> {
    if (!(await this.emailConfig.isConfigured())) {
      return { delivered: false, skippedReason: 'not_configured' };
    }

    const link = this.emailConfig.buildAcceptInviteLink(request.rawToken);

    try {
      await this.emailSender.sendMessage({
        channel: 'email',
        externalThreadId: request.email,
        subject: INVITE_SUBJECT,
        text: this.buildBody(link),
      });
      return { delivered: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`Invitation email delivery failed: ${message}`);
      return { delivered: false, error: message };
    }
  }

  /** Plain-text body: the accept link plus an expiry hint. No token echoed outside the link. */
  private buildBody(acceptLink: string): string {
    return [
      "You've been invited to join Nexus Orchestrator.",
      '',
      `Accept your invitation: ${acceptLink}`,
      '',
      'This invitation link will expire; if it has already expired, ask whoever invited you to send a new one.',
    ].join('\n');
  }
}
