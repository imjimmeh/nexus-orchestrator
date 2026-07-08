import { z } from 'zod';

/**
 * Body for the PUBLIC `POST /invitations/accept` endpoint.
 *
 * SECURITY: `existingUserId` is deliberately NOT a field on this schema.
 * `z.object` strips any unrecognized key during `safeParse` (it is not
 * `.passthrough()`/`.strict()`), so an `existingUserId` sent by a caller is
 * silently dropped before it ever reaches the controller. The accepting
 * user id for an already-authenticated caller is instead derived exclusively
 * from a verified JWT bearer token in `PublicInvitationController` — never
 * from client input. Accepting it from the body would let anyone holding a
 * valid invitation token grant that invitation's role to an arbitrary victim
 * account (privilege escalation).
 *
 * `username`/`password` are optional at the schema level (an already
 * logged-in caller supplies neither), but must be supplied TOGETHER when
 * either is present — enforced by the `.refine` below.
 */
export const AcceptInvitationBodySchema = z
  .object({
    token: z.string().min(1, 'token is required'),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
  })
  .refine(
    (body) => (body.username === undefined) === (body.password === undefined),
    {
      message: 'username and password must be provided together',
      path: ['username'],
    },
  );
