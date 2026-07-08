import type { z } from 'zod';
import type { AcceptInvitationBodySchema } from './invitation.dto';

/** Input contract for {@link InvitationService.createInvitation}. */
export interface CreateInvitationInput {
  scopeNodeId: string;
  roleId: string;
  email?: string;
  invitedByUserId: string;
}

/**
 * Request body for `POST /scopes/:scopeNodeId/invitations`. `scopeNodeId`
 * comes from the route param and `invitedByUserId` from the authenticated
 * JWT subject — neither is accepted from the body.
 */
export interface CreateInvitationBody {
  roleId: string;
  email?: string;
}

/** Details for provisioning a brand-new account on the accept path. */
export interface AcceptInvitationNewUser {
  username: string;
  password: string;
  email?: string;
}

/** Input contract for {@link InvitationService.acceptInvitation}. */
export interface AcceptInvitationInput {
  rawToken: string;
  /** Set when an already-logged-in user is accepting the invitation. */
  existingUserId?: string;
  /** Set when a brand-new person is accepting and needs an account created. */
  newUser?: AcceptInvitationNewUser;
}

/**
 * Request body for the PUBLIC `POST /invitations/accept` endpoint, validated
 * by {@link AcceptInvitationBodySchema} in `invitation.dto.ts`. Deliberately
 * has NO `existingUserId` field: see that schema's doc comment for why.
 */
export type AcceptInvitationBody = z.infer<typeof AcceptInvitationBodySchema>;
