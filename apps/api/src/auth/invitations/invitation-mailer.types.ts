/** Input for {@link InvitationMailer.sendInvitationEmail}. */
export interface InvitationEmailRequest {
  email: string;
  rawToken: string;
  scopeNodeId: string;
  roleId: string;
}

/**
 * Outcome of an invitation-email delivery attempt. `delivered: false` is
 * NOT an error the caller (Task 9's `InvitationService`) should treat as
 * fatal — an invitation is valid and usable via its accept link regardless
 * of whether the notification email went out, so callers should log and
 * continue rather than fail the invite/accept flow.
 */
export interface InvitationDeliveryResult {
  delivered: boolean;
  /** Set when delivery was skipped outright (e.g. SMTP not configured). */
  skippedReason?: 'not_configured';
  /** Set when a send was attempted but failed; the underlying error message. */
  error?: string;
}

/**
 * Dependency-inversion seam between `InvitationService` (Task 9) and the
 * concrete email stack (`EmailConfigService` + `EmailSenderService`, Tasks
 * 4-5). `InvitationService` depends only on this abstraction via the
 * {@link INVITATION_MAILER} token, never on `InvitationEmailService`
 * directly, so invitation issuance stays decoupled from how (or whether)
 * notification email is delivered.
 */
export interface InvitationMailer {
  sendInvitationEmail(
    request: InvitationEmailRequest,
  ): Promise<InvitationDeliveryResult>;
}
