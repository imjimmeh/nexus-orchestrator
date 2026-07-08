/**
 * Imported repository fixture — entry point.
 *
 * NOTE (intentional gap): this file exports a `handleUsersRequest` function
 * that serves `/api/users` without any authentication check. The fixture is
 * designed to look like a real TypeScript service so project-shape detection
 * succeeds, but the missing auth handling is a deliberate, clearly visible
 * gap that the imported-repo reconciler must surface as a `todo` work item.
 *
 * The probe result markdown at
 * `docs/project-context/probe-results/03-missing-authentication.md` is the
 * evidence the reconciler ingests to produce that `todo` work item.
 *
 * Exported types live in `./index.types.ts` to satisfy the project lint
 * rule that forbids exported interfaces inside non-types source files.
 */

import type {
  IncomingRequest,
  UserRecord,
  UsersResponse,
} from "./index.types.js";

export type {
  IncomingRequest,
  UserRecord,
  UsersResponse,
} from "./index.types.js";

const SEED_USERS: readonly UserRecord[] = [
  { id: "u-001", email: "ada@example.com", displayName: "Ada Lovelace" },
  { id: "u-002", email: "alan@example.com", displayName: "Alan Turing" },
  { id: "u-003", email: "grace@example.com", displayName: "Grace Hopper" },
];

/**
 * Handle a request to `/api/users`.
 *
 * INTENTIONALLY MISSING: authentication handling. In a real service this
 * function would:
 *   1. Inspect the `Authorization` header.
 *   2. Verify the bearer token against the identity provider.
 *   3. Reject the request with a 401 when no valid token is present.
 *   4. Enforce role-based authorization for the requested user list.
 *
 * None of those checks happen here. Any anonymous caller receives the full
 * user list, which is exactly the gap the fixture is meant to expose.
 */
export function handleUsersRequest(_request: IncomingRequest): UsersResponse {
  return {
    users: SEED_USERS,
    total: SEED_USERS.length,
  };
}

/**
 * Boot the HTTP service. Mirrors a typical `index.ts` entry point but, again,
 * does not wire any auth middleware into the request pipeline.
 */
export function bootstrapService(): UsersResponse {
  return handleUsersRequest({
    method: "GET",
    path: "/api/users",
    headers: {},
  });
}
