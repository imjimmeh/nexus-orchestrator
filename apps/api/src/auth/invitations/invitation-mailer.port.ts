/**
 * DI token for {@link InvitationMailer}. `InvitationService` (Task 9) injects
 * against this token rather than the concrete `InvitationEmailService`, so
 * the invitation domain never depends on the email/chat-channel stack
 * directly.
 *
 * The contract types live in `invitation-mailer.types.ts` (the project's
 * `*.types.ts` convention) and are re-exported here for ergonomic import
 * alongside the token.
 */
export const INVITATION_MAILER = Symbol('INVITATION_MAILER');

export type {
  InvitationEmailRequest,
  InvitationDeliveryResult,
  InvitationMailer,
} from './invitation-mailer.types';
