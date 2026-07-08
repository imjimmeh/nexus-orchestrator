# Multi-Tenant Scopes

> Status: Phases 0–5 complete. Phase 0 (below) covers the backend
> primitives — the tenant-boundary flag, the scope typing matrix, the single
> authorization authority, and subtree isolation. [Phase 1](#phase-1--member-management--granular-roles)
> builds member management and a granular role catalog on top of those
> primitives. [Phase 2](#phase-2--invitations-link-delivery) adds a
> subtree-bound invitation lifecycle with link-only delivery. [Phase 3](#phase-3--email-delivery)
> layers an opt-in email delivery channel on top of Phase 2's invitations
> without changing the link-based flow. [Phase 4](#phase-4--org-hierarchy-management-ui)
> ships a self-service org-hierarchy management UI — rename, move, archive,
> create-child, and tenant-boundary toggle — bounded to whatever subtree the
> caller can already manage. [Phase 5](#phase-5--app-wide-scope-framing)
> makes the active scope explicit and coherent across the entire web app —
> URL-driven scope, a two-plane shell (Platform vs. Tenant/Project
> workspace), plane- and permission-aware nav filtering, a persistent header
> switcher, and a default-deny backend filter rolled out to the primary list
> endpoints.

## Phase 0 — Backend Foundations

## Scope hierarchy recap

Scopes form a tree (`scope_nodes` + `scope_node_closure` for ancestor/descendant
lookups) rooted at a fixed well-known node, `GLOBAL_SCOPE_NODE_ID`
(`00000000-0000-0000-0000-000000000000`). Every node has a `type`:
`platform | org | region | team | project`. Source: `apps/api/src/scope/scope.constants.ts`.

## `is_tenant_root` — an orthogonal boundary flag

`scope_nodes.is_tenant_root` (boolean, `NOT NULL DEFAULT false`) marks a node as
a tenant/isolation boundary. It is **orthogonal to `type`** — any node type may
be a tenant root; the flag does not change how the node nests in the typing
matrix below, and it carries no authorization semantics on its own (access is
still governed exclusively by `role_assignments`, see below).

- Migration: `apps/api/src/database/migrations/20260714000000-add-scope-node-is-tenant-root.ts`
  (`up` adds the column, `down` drops it — fully reversible).
- Entity: `ScopeNode.isTenantRoot` (`apps/api/src/scope/database/entities/scope-node.entity.ts`).
- Input/DTO: `CreateScopeNodeInput.isTenantRoot` and `CreateScopeNodeDto.isTenantRoot`
  (`apps/api/src/scope/scope.service.types.ts`, `apps/api/src/scope/dto/create-scope-node.dto.ts`)
  — optional, defaults to `false` at both the type and persistence layer.
- Persistence: `ScopeService.createNode` and `ScopeService.ensureNode` both
  write `is_tenant_root` on insert.
- Projection: `ScopeTreeNode.isTenantRoot` is populated by `ScopeService.getTree`,
  so the flag survives the tree read path instead of being silently dropped.

## Parent → child typing matrix (SDD §2.3)

`assertValidParentChildType(parentType, childType)` in
`apps/api/src/scope/scope-typing.ts` is a pure function backed by the
`PARENT_CHILD_TYPE_MATRIX` table and throws `BadRequestException` for any
disallowed pairing:

| Parent type | Allowed child types                |
| ----------- | ---------------------------------- |
| `platform`  | `org`                              |
| `org`       | `org`, `region`, `team`, `project` |
| `region`    | `team`, `project`                  |
| `team`      | `team`, `project`                  |
| `project`   | _(none — leaf type)_               |

Enforcement points:

- `ScopeService.createNode` looks up the parent's type inside the same
  transaction as the insert and calls `assertValidParentChildType` before
  writing the row.
- `ScopeService.moveNode` looks up both the moved node's type and the new
  parent's type (after the existing parent-exists and cycle checks) and calls
  `assertValidParentChildType` before rewriting the closure table — so a move
  can never re-parent a node into a position the matrix disallows, even though
  the node's own type never changes across a move.

The matrix and every allowed/rejected pair are exhaustively unit-tested in
`apps/api/src/scope/scope-typing.spec.ts`.

## `role_assignments` — the single authorization authority

`role_assignments` is the **only** source of truth for who can do what at
which scope. The legacy `user_roles` table and JWT `roles` claims are
**never** consulted for authorization decisions:

- `AuthorizationService.getEffectivePermissions` and
  `ScopeAccessService.getAccessibleScopeIds` (`apps/api/src/auth/authorization/`)
  both query `role_assignments` (joined through `role_permissions` /
  `permissions` / `scope_node_closure`) and never reference `user_roles`.
- `PermissionsGuard` ignores the JWT's `roles` claim entirely for the
  allow/deny decision — a request whose JWT carries `roles: ["admin"]` is
  still denied if the caller has no matching `role_assignments` row.
- This invariant is locked in by a regression suite,
  `apps/api/src/auth/authorization/single-authority.regression.spec.ts`, which
  asserts the SQL text of both services contains `role_assignments` and never
  matches `/user_roles/i`, and that `PermissionsGuard`'s decision comes from
  `can()` (backed by `role_assignments`), not the JWT roles array.

## Startup integrity check — `AdminAccessIntegrityService`

Retiring `user_roles` as an authority depends on migration `20260609020000`
having backfilled a root-scoped `role_assignments` row for every legacy
`user_roles` grant. `AdminAccessIntegrityService`
(`apps/api/src/auth/authorization/admin-access-integrity.service.ts`) verifies
that invariant on every boot (`OnApplicationBootstrap`):

- `findLegacyRolesMissingRootAssignment()` runs a `NOT EXISTS` query for every
  `user_roles` row lacking a corresponding `role_assignments` row scoped to
  `GLOBAL_SCOPE_NODE_ID`.
- Any orphan is logged as an error naming the affected `user_id` / `role_id`
  and pointing at remediation (re-run the backfill migration, or assign the
  role at the global root manually).
- The check is **non-fatal**: a query failure or a non-empty orphan list is
  logged, never thrown — a legacy-admin gap is a loud warning, not a
  crash-loop.

## Subtree isolation

`ScopeAccessService.getAccessibleScopeIds` and `ScopeService.getTree` both
confine a caller to the **union of their assigned subtrees** and never leak
sibling subtrees the caller was not granted:

- `getAccessibleScopeIds` walks `scope_node_closure` from every scope the
  caller holds a `role_assignments` row at, down through all descendants, and
  de-duplicates across overlapping/multiple assigned subtrees. Two users
  assigned to disjoint subtrees never see each other's node ids (see
  `apps/api/src/auth/authorization/scope-access.service.spec.ts`).
- `getTree` builds the full tree once, then — when a `userId` and
  `ScopeAccessService` are available — prunes every branch not in the
  caller's accessible-id set (plus each accessible node's ancestor chain, so
  the pruned tree stays connected to the root). A caller who is not
  `GLOBAL_SCOPE_NODE_ID`-scoped never sees a sibling tenant's subtree in the
  response (see `apps/api/src/scope/scope.service.spec.ts`,
  `confines a scoped user to the union of assigned subtrees and hides siblings`).

## Phase 1 — Member Management & Granular Roles

Phase 1 answers "who is a member of this scope, and what can they do here?"
It ships a granular, auto-generated role catalog and a unified members
surface that resolves both direct and inherited grants — fixing a bug where
per-scope member lists appeared empty even though a caller's access was
correctly inherited from a parent scope.

### Role catalog

The fixed broad roles are `platform_admin`, `tenant_admin`, `member`, and
`viewer` (plus the legacy `admin`/`user` globals). `tenant_admin` is a
**rename** of the former `org_admin` — same permission set (`manage` on
`scopes`, `resources`, `workflows`, `agents`, `skills`, `approvals`, `goals`,
`memory`, `budgets`, `roles`; `read` on `users`, `settings`), new name to
match the tenant framing introduced in Phase 0. Migration
`apps/api/src/database/migrations/20260714010000-rename-org-admin-to-tenant-admin.ts`
renames existing `org_admin` rows in place (`up`) and is fully reversible
(`down`); both directions are guarded by a `WHERE name = ...` clause so the
migration is a no-op on a database where the row is already renamed or
absent.

On top of the fixed roles, one **auto-generated `<resource>_admin` role** is
derived per entry in the permission catalog's `RESOURCES` list (for example
`workflows_admin`, `secrets_admin`, `agents_admin`), each granting exactly
`<resource>:manage`. A `member_admin` composite role grants `roles:manage` +
`users:manage` — the ability to manage membership and role grants within a
scope without full `tenant_admin` breadth. All of this is derived once from
`apps/api/src/auth/authorization/permission-catalog.ts`
(`resourceAdminRoleName()`, `RESOURCE_ADMIN_ROLE_NAMES`,
`MEMBER_ADMIN_ROLE_NAME`) and consumed by both
`apps/api/src/database/seeds/authorization/roles.seed.ts` (`buildSeedRoles()`)
and `apps/api/src/database/seeds/authorization/role-permissions.seed.ts`
(`buildRolePermissionMappings()`), so the generated role set can never drift
out of sync as `RESOURCES` grows — adding a resource to the catalog
automatically produces its `<resource>_admin` role and permission mapping on
next seed run.

### Membership: direct vs. inherited

`role_assignments` remains the single membership authority (Phase 0). A
user is a **member of a scope node** if they hold a `role_assignments` row
either at that node (**direct**, closure depth 0) or at any ancestor node
(**inherited**, closure depth > 0), resolved by walking
`scope_node_closure` — the same mechanism `AuthorizationService.getEffectivePermissions`
uses for permission checks.

`RoleAssignmentService.listEffectiveMembersAtNode(scopeNodeId)`
(`apps/api/src/auth/authorization/role-assignment.service.ts`) runs a single
raw-SQL join across `role_assignments`, `scope_node_closure`, `users`,
`roles`, and `scope_nodes` and returns an `EffectiveMember[]`
(`packages/core/src/schemas/roles/effective-member.schema.ts`):

```ts
interface EffectiveMember {
  userId: string;
  userEmail: string;
  roleId: string;
  roleName: string;
  source: "direct" | "inherited";
  sourceScopeNodeId: string;
  sourceScopeName: string;
}
```

`source` is `"direct"` when the underlying grant's closure depth is `0`
(the grant lives at the requested node itself) and `"inherited"` otherwise,
with `sourceScopeNodeId`/`sourceScopeName` identifying which ancestor scope
the grant actually originates from.

### `GET /scopes/:scopeNodeId/members`

`RoleAssignmentController.listMembers` exposes this as
`GET /scopes/:scopeNodeId/members`, guarded by `@RequirePermission('roles:read')`.
`PermissionsGuard` resolves the target scope from `params.scopeNodeId`, so a
tenant-scoped caller cannot read membership for a node outside their subtree
(Phase 0 subtree isolation applies unchanged).

### Web: `ScopeMembersPanel`

`apps/web/src/components/scope/ScopeMembersPanel.tsx` is the single,
unified members surface for a scope node. It replaces two prior UI paths:
the buried `MembersRolesTab` dialog on the scope detail page, and the
confusing non-global read-only branch of `Users.tsx` — both of which are
deleted. `ScopeMembersPanel` is now rendered from both
`apps/web/src/pages/scopes/ScopeDetailPage.tsx` and the non-global branch of
`apps/web/src/pages/Users.tsx`.

The panel shows:

- **Direct members** — editable table (role badge + revoke button), backed
  by `useScopeMembers`/`useRevokeScopeMember`
  (`apps/web/src/hooks/useScopeMembers.ts`). Revoke calls
  `DELETE /scopes/:scopeNodeId/role-assignments` with a `{ userId, roleId }`
  body, since `EffectiveMember` carries no assignment id to revoke by.
- **Inherited members** — read-only table, each row tagged with an
  `↑ {sourceScopeName}` badge showing which ancestor scope the grant comes
  from. This is the fix for the "shows no one" bug: scopes that only had
  inherited (e.g. platform-admin) members previously rendered an empty
  member list because the old surfaces only ever queried direct
  `role-assignments` at the node itself.
- **User-picker autocomplete** — searches users via `GET /users?search=`
  (`useUserSearch`, min 2 characters) and adds a member via the existing
  `assignRole` mutation once a user and role are selected. There is no
  raw-user-id input.
- **Invite button** — in Phase 1 this was present but disabled behind an
  `INVITE_STUB_TOOLTIP`. [Phase 2](#phase-2--invitations-link-delivery) wires
  it up to open `InviteDialog`; the stub tooltip and constant no longer exist.

## Phase 2 — Invitations (Link Delivery)

Phase 2 answers "how does a scope admin bring a new person into a scope
without an existing account?" It ships a subtree-bound, single-use invitation
lifecycle with **link-only delivery** — no new infrastructure (no email
sending, no SMS) — while keeping the return shape and persisted data ready
for Phase 3 to layer email delivery on top without any rework.

### `Invitation` entity and lifecycle

`Invitation` (`apps/api/src/auth/invitations/database/entities/invitation.entity.ts`,
table `invitations`) is modeled directly on the existing refresh-token
pattern:

```ts
@Entity("invitations")
export class Invitation {
  id: string; // uuid
  tokenHash: string; // column: token_hash, select: false — never returned by a normal read
  scopeNodeId: string;
  roleId: string;
  email: string | null;
  invitedByUserId: string;
  status: InvitationStatus; // 'pending' | 'accepted' | 'revoked' | 'expired'
  expiresAt: Date;
  acceptedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
```

- The raw token is `crypto.randomBytes(64).toString('hex')` (128 hex chars),
  generated once in `InvitationService.createInvitation` and returned to the
  caller **exactly once** as `rawToken` alongside the persisted `invitation`
  row (`{ invitation, rawToken }`). Only its HMAC-SHA-256 hash
  (`hashRefreshToken`, the same helper and `REFRESH_TOKEN_HMAC_KEY` used for
  refresh tokens) is persisted, in the `select: false` `token_hash` column —
  it is never returned from a list/read query and never logged.
- Default expiry is **7 days** (`DEFAULT_INVITATION_EXPIRY_DAYS` in
  `apps/api/src/auth/invitations/invitation.constants.ts`).
- Status values (`apps/api/src/auth/invitations/invitation.status.types.ts`):
  `pending → accepted | revoked | expired`. An invitation binds
  `scope_node_id` + `role_id` + an optional `email` + the issuing
  `invited_by_user_id`.
- Migration: `apps/api/src/auth/invitations/20260714020000-create-invitations.migration.spec.ts`
  covers the `invitations` table migration (registered alongside the other
  API migrations).

### `InvitationService` — the single lifecycle authority

`apps/api/src/auth/invitations/invitation.service.ts` owns every lifecycle
transition; the controllers below are transport-only.

- **`createInvitation(input): Promise<{ invitation, rawToken }>`** — first
  asserts the issuer can manage the target scope subtree (see below), then
  generates and hashes the token and persists the row as `pending`.
- **`acceptInvitation(input): Promise<{ userId }>`** — the whole accept
  (invitation load, user resolution, role grant, invitation status flip) runs
  inside **one database transaction**, with the invitation row read under a
  `pessimistic_write` lock (`SELECT ... FOR UPDATE`). This makes the
  single-use invariant hold even under a concurrent double-accept: the second
  transaction blocks on the locked row until the first commits, then observes
  the now-`accepted` status and is rejected — two racing accepts on the same
  still-pending token can never both succeed.
  - **Entry point 1 (existing user):** the caller supplies
    `existingUserId` (see the public-endpoint note below on where this comes
    from) and the role is granted to that account.
  - **Entry point 2 (brand-new user):** the caller supplies `newUser: {
username, password, email? }`; a new `User` row is created inside the
    same transaction (duplicate username/email rejected with
    `ConflictException`, password hashed via `PasswordHashingService` before
    it ever touches persistence) and the role is granted to the new account.
    If the accept payload omits an email, the invitation's own `email` is
    used as a fallback; if neither is present, account creation is rejected
    with a clean `BadRequestException` (never a raw DB not-null violation).
  - The role grant itself reuses `RoleAssignmentService.assignRole` — Phase 2
    does not reimplement role assignment.
  - **Expiry handling:** an expired invitation cannot self-heal inside the
    accept transaction (rejecting also rolls back any status write), so the
    load throws an internal `ExpiredInvitationError` that rolls the
    transaction back and releases the lock; `acceptInvitation` then performs
    a best-effort, durable `status = expired` flip through the repository
    _after_ the lock is gone, and rethrows the same uniform public error as
    every other unacceptable-token case.
  - **Uniform error:** unknown token, wrong status (already accepted /
    revoked), and expired all surface the identical
    `"Invalid or expired invitation"` `NotFoundException` — the service never
    gives an attacker a way to distinguish "this token never existed" from
    "this token existed and was already used," which would otherwise let a
    caller enumerate valid tokens.
- **`revokeInvitation(id, actorUserId)`** — same subtree-manage bound as
  create; rejects a non-existent id (`NotFoundException`) and rejects an
  invitation that has already left `pending` (`ConflictException`) — revoke
  is only meaningful against a still-live invite.
- **`listInvitationsAtNode(scopeNodeId)`** — lists pending invitations for the
  management UI; the repository query never selects `tokenHash`, so a hash
  can never reach a list response even indirectly.
- **Subtree bound:** both `createInvitation` and `revokeInvitation` call a
  shared `assertIssuerCanManageScope` that checks the actor's
  `roles:manage` permission via `ScopeAccessService.getAccessibleScopeIds` —
  the same subtree-isolation mechanism as the rest of the scope system (see
  Phase 0). An issuer can only invite or revoke within scopes they can
  already manage.

### API surface

- **Guarded** `InvitationController` (`apps/api/src/auth/invitations/invitation.controller.ts`),
  behind `JwtAuthGuard` + `PermissionsGuard`:
  - `POST /scopes/:scopeNodeId/invitations` (`roles:manage`) → `{ invitation, inviteToken }`.
  - `GET /scopes/:scopeNodeId/invitations` (`roles:read`) → pending invitations at that node.
  - `DELETE /invitations/:id` (`roles:manage`, `204`) — note this route carries
    no `:scopeNodeId` param, so `PermissionsGuard`'s check is a coarse "can
    manage roles somewhere" gate; the real subtree-scoped authorization is
    `InvitationService.revokeInvitation`'s own `assertIssuerCanManageScope`
    call, which is the actual authority.
- **Public** `PublicInvitationController` (`apps/api/src/auth/invitations/public-invitation.controller.ts`),
  deliberately carrying **no** `JwtAuthGuard`/`PermissionsGuard` — accepting an
  invitation is the first authenticated action for a brand-new user, so the
  route cannot require a bearer token up front:
  - `POST /invitations/accept` accepts an **optional** `Authorization` header.
    If present and it verifies against `JwtService`, its `sub` claim becomes
    `existingUserId` (entry point 1 above); a missing or invalid token is
    treated as anonymous rather than rejected, routing down the new-user path
    (entry point 2). This is what makes it "optional auth" rather than a
    guard.
  - **`existingUserId` is never read from the request body.**
    `AcceptInvitationBodySchema` (`apps/api/src/auth/invitations/invitation.dto.ts`)
    has no such field, and a plain (non-strict, non-passthrough) Zod object
    schema silently strips any unrecognized key — so even a client that sends
    one has it dropped before the controller sees it. Reading it from the
    body would let anyone holding a valid invitation token grant that
    invitation's role to an arbitrary victim account.
  - On success the endpoint logs the accepted user straight in: it returns
    `{ userId, accessToken, refreshToken }` using the same
    `TokenService`/`RefreshTokenService` issuance path as normal login.
  - `INVITATION_STATUS_VALUES` are the only status strings ever compared —
    nothing distinguishes them at the API boundary beyond the uniform error
    above.
  - **Rate-limit seam (not built):** the endpoint is covered only by the
    application's broad, generous default `ThrottlerGuard` — there is no
    per-route throttle on accept attempts yet. This is a deliberate, tracked
    gap (see the `TODO(phase-2 hardening)` in `public-invitation.controller.ts`),
    not an oversight.
- `InvitationModule` (`apps/api/src/auth/invitations/invitation.module.ts`) is
  imported directly by `AppModule` and exports only `InvitationService`.

### Web: invite, list, and accept

- **`InviteDialog`** (`apps/web/src/components/scope/InviteDialog.tsx`) —
  presentation-only; the create-invitation side effect lives in the
  `useCreateInvitation` hook. On success it shows a read-only, copyable
  invite link built by `buildInviteLink` — the dialog never shows the raw
  token by itself, only the assembled URL.
- **`buildInviteLink`** (`apps/web/src/lib/inviteLink.ts`) builds
  `<base>/accept-invite?token=<rawToken>`, where `<base>` is
  **`VITE_PUBLIC_APP_URL`** when set (non-empty), else
  `window.location.origin` (see `apps/web/src/vite-env.d.ts` for the typed,
  optional env var). Set `VITE_PUBLIC_APP_URL` in any deployment where the
  browser's own origin isn't the public-facing URL invitees should land on
  (e.g. behind a reverse proxy, or when the admin UI and the invitee-facing
  origin differ).
- **`PendingInvitationsList`** (`apps/web/src/components/scope/PendingInvitationsList.tsx`)
  — lists pending invitations for a scope node (email or `(link-only)` when
  no email was supplied, role, status, expiry, revoke button), backed by
  `useInvitations`/`useRevokeInvitation`
  (`apps/web/src/hooks/useInvitations.ts`).
- Both are wired into `ScopeMembersPanel`
  (`apps/web/src/components/scope/ScopeMembersPanel.tsx`), whose **Invite**
  button now opens `InviteDialog` (superseding the Phase 1 disabled stub).
- **`AcceptInvite`** (`apps/web/src/pages/AcceptInvite.tsx`), routed publicly
  at `/accept-invite?token=...` in `App.tsx` — no auth guard on the route.
  Branches on `useAuthStore`'s `isAuthenticated`: an already-logged-in caller
  gets a single "Accept invitation" button (no credential form, sends only
  the token); an anonymous visitor gets a username/password form and accepts
  as a brand-new account. Every failure (missing token, invalid/expired
  token, any backend rejection) renders the same generic message — the page
  mirrors the backend's uniform-error design and never surfaces which
  specific reason the accept failed. `useAcceptInvitation`
  (`apps/web/src/hooks/useAcceptInvitation.ts`) calls
  `POST /invitations/accept`; on success `App`'s auth store (`auth.store`)
  is populated via `setSession` from the returned tokens and the user is
  redirected to `/`.

### Delivery is link-only this phase

There is no email (or any other) delivery mechanism in Phase 2 — the invite
link is shown once in `InviteDialog` for the issuer to copy and send through
whatever out-of-band channel they choose. This is a deliberate scope cut, not
a gap: `createInvitation` already returns `{ invitation, rawToken }`, and the
`Invitation` row already carries the optional `email`, so Phase 3 can add an
email send that consumes `{ invitation, rawToken, email }` and dispatches a
notification without changing the create path, the entity, or the accept
path at all.

> **Superseded by [Phase 3](#phase-3--email-delivery) below**: email delivery
> now exists, but strictly as an _additional_, opt-in path — the copyable
> link described above is still always generated and still works
> unconditionally, whether or not email delivery is configured or succeeds.

### Kanban-neutrality and security posture

- No `kanban`, work-item, or project-domain identifier appears anywhere in
  `apps/api/src/auth/invitations/**` or the web invitation surface
  (`InviteDialog`, `PendingInvitationsList`, `AcceptInvite`, the invitation
  hooks/client) — verified by grep as part of every Phase 2 task and again at
  Phase 2 sign-off.
- No raw token, password, or invitation secret is ever passed to a
  `console.*` or `Logger` call anywhere in the invitations backend or the web
  accept/invite surfaces (verified by grep at sign-off). The token is
  persisted only as a hash (`token_hash`, `select: false`) and is returned to
  the issuer's browser exactly once, at creation time.

## Phase 3 — Email Delivery

Phase 3 answers "how does the invitee actually find out they've been
invited?" It adds email as an **additional, opt-in** delivery path for the
Phase 2 invitation lifecycle — the copyable accept link is unaffected and
always still generated; email is a bonus, not a replacement. Plan:
`docs/plans/multi-tenant-phase-3-email-delivery.md` (Task 10, this doc).

### Behavior in one sentence

When SMTP is configured (see below) **and** an invitation carries an
`email`, `InvitationService.createInvitation` sends the invitee an email
containing the accept link, **best-effort**: any failure anywhere in that
send path — SMTP not configured, transport error, malformed config — is
caught, logged, and returned as a non-fatal `emailDelivery` result. It never
throws out of `createInvitation`, never rolls back the invitation write, and
never prevents the issuer from getting back `{ invitation, rawToken }` and
the copyable link exactly as in Phase 2.

### Config: env vars and precedence

All of the following are **optional**. A blank value (`SMTP_HOST=` with
nothing after the `=`, as ships in `.env.example`) is treated identically to
an unset var, so `cp .env.example .env` never crashes the API on boot. This
holds for `PUBLIC_APP_URL` too: `dotenv` parses a bare `KEY=` line to `''`
(not `undefined`), so `validation.schema.ts` wraps every var in this block —
`PUBLIC_APP_URL` included — with a `blankToUndefined` preprocess, letting a
blank value fall through to the default (or `undefined`) rather than fail the
`.url()`/`.uuid()`/`.min(1)` check.

| Var                       | Default                 | Notes                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PUBLIC_APP_URL`          | `http://localhost:3120` | Public origin used to build the accept-invite link (`${PUBLIC_APP_URL}/accept-invite?token=...`), trailing slash trimmed.                                                                                                                                                                                              |
| `SMTP_HOST`               | _(none)_                | SMTP server host. `SMTP_HOST` + `SMTP_FROM` are the minimum pair required for email to be considered "configured" — see below.                                                                                                                                                                                         |
| `SMTP_PORT`               | `587`                   | SMTP server port.                                                                                                                                                                                                                                                                                                      |
| `SMTP_USER`               | _(none)_                | SMTP auth username. Only used if a password also resolves (see precedence below); a lone `SMTP_USER` with no resolvable password logs a warning and sends unauthenticated rather than with a mismatched credential.                                                                                                    |
| `SMTP_SECURE`             | `false`                 | Whether to use an implicit-TLS connection (nodemailer `secure` option).                                                                                                                                                                                                                                                |
| `SMTP_FROM`               | _(none)_                | `From:` address/header for outbound invitation emails.                                                                                                                                                                                                                                                                 |
| `SMTP_PASSWORD_SECRET_ID` | _(none)_                | Preferred: id of a `secret_store` row holding the SMTP password. Must be a **UUID** (the config schema enforces `.uuid()`, so a non-UUID value fails validation at boot). Resolved via `SecretCrudService.findByIdRaw`, tolerant of a raw string or JSON (`"value"`, `{"password":...}`, `{"value":...}`) secret body. |
| `SMTP_PASSWORD`           | _(none)_                | Fallback only, not recommended for production: plaintext SMTP password read directly from env.                                                                                                                                                                                                                         |

**Password precedence:** `SMTP_PASSWORD_SECRET_ID` (secret store) **wins over**
`SMTP_PASSWORD` (plaintext env) whenever the secret id resolves to a usable
value. If the secret id is set but the lookup fails or yields nothing
usable, `EmailConfigService` logs a warning (naming only the non-sensitive
secret id, never the password) and falls back to `SMTP_PASSWORD`. The
resolved password — from either source — is never logged.

**"Configured" means `SMTP_HOST` and `SMTP_FROM` are both present** (after
blank-to-absent normalization); `EmailConfigService.isConfigured()` is the
single source of truth other code asks. Everything else (port, secure,
user/password) is optional on top of that pair.

### Code stack (mirrors the existing Telegram channel)

- `MAILER_TRANSPORT_FACTORY` (`apps/api/src/chat/channel-adapters/email/mailer-transport.ts`)
  — DI token wrapping `nodemailer.createTransport` behind a factory seam, so
  unit tests inject a fake transport instead of opening real SMTP
  connections.
- `EmailConfigService` (`.../email/email-config.service.ts`) — resolves
  `ResolvedSmtpSettings` from env + secret store (the precedence above) and
  builds the accept-invite link from `PUBLIC_APP_URL`.
- `EmailSenderService implements ChannelOutboundSender`
  (`.../email/email-sender.service.ts`) — sends a message over SMTP via the
  transport factory; mirrors `TelegramSenderService`'s pattern of extending
  the shared `ChannelOutboundMessage` shape (here, with an optional
  `subject`). Logs only the recipient's domain (never the full address or
  body) on failure.
- `NotificationConsumerService` (`apps/api/src/chat/notifications/notification-consumer.service.ts`)
  now resolves `channel === 'email'` to `EmailSenderService.sendMessage`,
  alongside the existing `channel === 'telegram'` branch — email is "just
  another channel" on the same outbound notification substrate, not a
  parallel mechanism.
- `INVITATION_MAILER` port + `InvitationEmailService`
  (`apps/api/src/auth/invitations/invitation-mailer.port.ts`,
  `invitation-email.service.ts`) — the dependency-inversion seam between the
  invitation domain and the concrete email stack. `InvitationEmailService`
  composes `EmailConfigService.buildAcceptInviteLink` with
  `EmailSenderService.sendMessage` and implements `InvitationMailer`,
  returning an `InvitationDeliveryResult` (`{ delivered: boolean;
skippedReason?: 'not_configured'; error?: string }`) that never throws.
- `InvitationService.createInvitation` (`apps/api/src/auth/invitations/invitation.service.ts`)
  injects `INVITATION_MAILER` with `@Optional()` — the invitation domain
  never hard-depends on the email/chat-channel stack — and, after
  persisting the invitation, calls a private
  `deliverInvitationEmailBestEffort` helper that: skips outright (returning
  `{ delivered: false, skippedReason: 'not_configured' }`) when there is no
  bound mailer or the invitation has no `email`; otherwise calls
  `sendInvitationEmail` inside its own `try`/`catch` as defense in depth on
  top of `InvitationEmailService`'s own never-throws contract. The return
  shape widens to `{ invitation, rawToken, emailDelivery }` — the issuer (and
  the web `InviteDialog`) can inspect `emailDelivery.delivered` if they want
  to react to a failed send, but the invitation and its copyable link are
  valid either way.

### Web

No web changes were required for the delivery path itself: `InviteDialog`
already shows the copyable accept link unconditionally (Phase 2), and that
behavior is unchanged — email delivery is a silent, additional side effect
of `createInvitation`, not something the create form needs to know about.

## Phase 4 — Org-Hierarchy Management UI

Phase 4 answers "how does a tenant admin reorganize their own subtree without
filing a platform-admin ticket?" It ships a self-service management surface
— rename, move, archive, create-child, and toggle the tenant-boundary flag —
gated per-node by the caller's actual permissions and, structurally, unable
to reach outside the subtree they can already manage.

### Guard change: `scopes:create` resolves at `body.parentId`

`POST /scopes` carries no `:scopeId`/`:scopeNodeId` route param — the node
being created doesn't exist yet, so there is nothing to key a subtree check
off of. `PermissionsGuard.resolveScopeNodeId`
(`apps/api/src/auth/authorization/permissions.guard.ts`) resolves the scope
to check against in this order: `params.scopeNodeId` → `params.scopeId` →
`query.scopeNodeId` → `body.scopeNodeId` → **`body.parentId`**. For a create
call this bottoms out at `body.parentId`, so `scopes:create` is authorized
against the **parent** node's subtree — a caller who can manage `org-a` can
create children under `org-a`, but posting a `parentId` outside their
accessible subtree is denied by the same mechanism that already governs
every other scope-scoped route.

### Subtree-bound archive / move / restore / update

`archiveNode`, `restoreNode`, `moveNode`, and the new `updateNode` route all
key `PermissionsGuard` off the **node's own id**, not the global root. The
route params were `:id` on `archive`/`restore`/`move` before Phase 4;
`ScopeController` (`apps/api/src/scope/scope.controller.ts`) renames all
three to `:scopeId` so `resolveScopeNodeId`'s `params.scopeId` branch picks
them up:

```
POST  /scopes/:scopeId/archive              scopes:manage
POST  /scopes/:scopeId/restore              scopes:manage
PATCH /scopes/:scopeId/move                 scopes:update
PATCH /scopes/:scopeId                      scopes:update   (new, see below)
GET   /scopes/:scopeId/allowed-child-types  scopes:read     (new, see below)
```

Before this rename, all three routes gated at whatever scope the caller's
JWT/session defaulted to rather than the target node's own subtree — a
platform-wide `scopes:manage` grant was required to archive/restore/move
_any_ node. After the rename, a `tenant_admin` scoped only to `org-a` can
archive/restore/move nodes inside `org-a` without a platform-wide grant,
while remaining unable to touch a sibling org's subtree.

### `isTenantRoot` restricted to `org` / `platform`

`ScopeService` (`apps/api/src/scope/scope.service.ts`) adds
`assertValidTenantRootType(isTenantRoot, type)`, backed by a
`TENANT_ROOT_ELIGIBLE_TYPES` set (`org`, `platform`), and calls it from both
`createNode` and `updateNode` before touching persistence. Requesting
`isTenantRoot: true` on any other node type (`region`, `team`, `project`)
throws `BadRequestException` — a `region`/`team`/`project` can never become a
tenant/isolation boundary, only an `org` (the common case) or the platform
root itself.

### `ScopeService.getAllowedChildTypes(nodeId)`

Returns the allowed child types for a node, sourced directly from
`PARENT_CHILD_TYPE_MATRIX[node.type]` (`apps/api/src/scope/scope-typing.ts`
— see the Phase 0 typing matrix above), so the UI's create-child type
dropdown can never drift out of sync with the enforcement the transaction
already applies. Throws `NotFoundException` for an unknown node id.

### `ScopeService.updateNode(nodeId, changes)`

Renames a node and/or toggles `isTenantRoot`, applying only the fields
present in `changes` (partial update — omitting `name` leaves it untouched,
same for `isTenantRoot`). Rejects updates to `GLOBAL_SCOPE_NODE_ID`
(`BadRequestException`, "Cannot update the platform root node") and
re-validates the tenant-boundary type restriction above against the node's
existing type. **Known gap — audit coverage:** `createNode` is currently the
only scope mutation that records an audit event
(`AuthorizationAuditService.recordScopeCreated`). `moveNode`, `archiveNode`,
`restoreNode`, and the new `updateNode` do **not** emit audit events —
`recordScopeMoved`/`recordScopeDeleted` exist on the audit service but are
never invoked from `ScopeService`, and no `recordScopeUpdated` method exists
at all. Phase 4 deliberately does not invent a new audit contract here (see
the `NOTE` comment at the `updateNode` call site). Wiring audit coverage
across all scope mutations — including a new `recordScopeUpdated` — is a
tracked follow-up.

### Web: `OrgHierarchyManager` and the `/scopes/:id/manage` page

- **`OrgHierarchyPage`** (`apps/web/src/pages/scopes/OrgHierarchyPage.tsx`),
  routed at `/scopes/:id/manage` in `App.tsx`, renders
  `OrgHierarchyManager` for the `:id` subtree. `ScopeDetailPage`
  (`apps/web/src/pages/scopes/ScopeDetailPage.tsx`) links to it via a
  **"Manage hierarchy"** button that navigates to `/scopes/${node.id}/manage`.
- **`OrgHierarchyManager`** (`apps/web/src/components/scope/manage/OrgHierarchyManager.tsx`)
  loads the full scope tree (`useScopeTree`), finds the subtree rooted at
  `rootScopeNodeId`, and renders it via `OrgHierarchyNode`
  (`apps/web/src/components/scope/manage/OrgHierarchyNode.tsx`). It calls
  **`useMyPermissions(rootScopeNodeId)`**
  (`apps/web/src/hooks/useMyPermissions.ts`) once for the whole subtree and
  derives three booleans — `canCreate` (`scopes:create`), `canUpdate`
  (`scopes:update`), `canManage` (`scopes:manage`) — passed down to every
  node in the tree to gate its create/rename/move/archive actions.
  `useMyPermissions` also honors the `<resource>:manage` wildcard
  (`evaluateCan`: `scopes:manage` implies `scopes:create`/`scopes:update`),
  mirroring `AuthorizationService.can()` on the backend.
- **`CreateChildDialog`** (`.../manage/CreateChildDialog.tsx`) fetches
  `useAllowedChildTypes(parentNode.id)` (backed by the new
  `GET /scopes/:scopeId/allowed-child-types` endpoint) to populate its type
  dropdown — it can never offer a type the backend would reject. The
  "mark as tenant boundary" checkbox is shown **only when the selected type
  is `org`** (`TENANT_ROOT_ELIGIBLE_TYPE`), matching the backend's
  `org`/`platform` restriction (`platform` is never created via this dialog,
  since it isn't a valid child type for anything).
- **`RenameScopeDialog`** and **`MoveScopeDialog`**
  (`.../manage/RenameScopeDialog.tsx`, `.../manage/MoveScopeDialog.tsx`) call
  `PATCH /scopes/:scopeId` and `PATCH /scopes/:scopeId/move` respectively.
  `MoveScopeDialog`'s parent picker is **cycle-safe by construction**:
  `collectExcludedIds` walks the moved node's own subtree and excludes every
  id in it (the node itself plus all descendants) from the dropdown, so the
  UI cannot even present a choice that would create a cycle — the backend's
  own cycle check in `ScopeService.moveNode` remains the authority, this is
  defense in depth at the presentation layer.
- **`TenantBoundaryToggle`** (`.../manage/TenantBoundaryToggle.tsx`) renders
  a switch calling `PATCH /scopes/:scopeId` with `{ isTenantRoot }`, but
  renders **nothing** (`return null`) for any node whose type isn't `org` or
  `platform` — the same eligibility set as the backend guard, so the control
  never appears where the backend would reject it anyway.
- **Subtree-bound self-service, end to end:** a `tenant_admin` or
  `member_admin` whose `role_assignments` only cover `org-a` sees
  `OrgHierarchyManager` render just the `org-a` subtree (the tree fetch is
  already pruned server-side per Phase 0's subtree isolation), and every
  mutation they can trigger from that UI is re-checked against `org-a`'s
  subtree by `PermissionsGuard` regardless of what the UI shows — the UI
  gating is a usability layer, not the authorization boundary.

## Phase 5 — App-Wide Scope Framing

Phase 4 gave a tenant admin a self-service surface for their own subtree.
Phase 5 answers a broader question: **for any page in the app, is it
obvious right now whether you're looking at the whole platform or one
tenant's workspace, and can that context be bookmarked, shared, and trusted
not to leak data across tenants?** It makes the active scope explicit and
URL-driven everywhere, splits the shell into two planes with nav filtered by
plane and real effective permissions, and rolls a single default-deny
filtering pattern across the backend's primary list endpoints. Plan:
`docs/plans/multi-tenant-phase-5-scope-framing.md`.

### Two planes: Platform vs. Tenant/Project workspace

`AppPlane` (`apps/web/src/lib/scope/plane.types.ts`) is a two-value type,
`"platform" | "workspace"`, derived from the active scope by a pure helper:

```ts
// apps/web/src/lib/scope/plane.ts
export function resolvePlane(activeScopeNodeId: string): AppPlane {
  return activeScopeNodeId === GLOBAL_SCOPE_NODE_ID ? "platform" : "workspace";
}
```

There is no independent plane state — the plane is always a pure function of
whichever scope node is currently active. Selecting `GLOBAL_SCOPE_NODE_ID`
(the well-known platform root, see [Phase 0](#phase-0--backend-foundations))
puts the app in the **Platform** plane; selecting any other node (an org,
region, team, or project) puts it in the **Tenant/Project workspace** plane.

### Scope-in-URL: `?scope=<id>` is the source of truth

`ScopeContext` (`apps/web/src/context/ScopeContext.tsx`) derives
`activeScopeNodeId` from React Router's `useSearchParams`, not local
component state:

- **Read precedence:** `?scope=<scopeNodeId>` URL param → localStorage key
  `nexus_active_scope_node_id` → `GLOBAL_SCOPE_NODE_ID`.
- **Write path:** `setActiveScopeNodeId(id)` writes the `scope` search param
  via `setSearchParams(..., { replace: true })` (no extra history entry per
  switch) **and** mirrors the value to localStorage. At
  `GLOBAL_SCOPE_NODE_ID` the `scope` param is **removed** rather than set to
  the well-known global id — "Platform (global)" is represented by the
  _absence_ of the param, keeping bookmarked platform-root URLs clean.
- **Back-compat:** localStorage is retained only as a fallback/mirror for
  bookmarks or tabs created before the `?scope=` param existed, and for
  other tabs that haven't navigated yet. There is no forced redirect and no
  migration step — an old bookmark with no `?scope=` param still resolves
  (via localStorage, then the global default) exactly as before.
- **Deep-link/shareable:** because the scope lives in the URL, a link copied
  and sent to a teammate (or saved as a bookmark) reproduces the same active
  scope on load, subject to that teammate's own accessible-subtree
  authorization — the URL carries _which_ scope was intended, never a grant
  of access to it.

### Persistent header switcher — `ScopeBanner` retired

`ScopeSwitcher` (`apps/web/src/components/scope/ScopeSwitcher.tsx`) is an
always-visible button rendered in the `Header`, replacing the old
dismissible `ScopeBanner`/pill (`ScopeBanner` and its export from
`components/scope/index.ts` were deleted outright — no re-export, no
`@deprecated` shim). It shows:

- **`Platform (global)`** — a fixed label — when `resolvePlane` resolves to
  `"platform"`.
- The active scope's breadcrumb path (`activeScopePath`, e.g.
  `Platform › Acme › Engineering`) joined with `›` separators, otherwise.

Clicking it calls `toggleScopePanel()`, opening the existing scope-tree
popover — the switcher is presentation-only; the panel/tree it opens is
unchanged from earlier phases.

### Two-plane nav filtering — `filterNavGroupsByRole`

`NAV_GROUPS` (`apps/web/src/components/layout/navigation.config.ts`) now
carries two pieces of optional metadata per group/item:

```ts
type NavItem = {
  label: string;
  icon: LucideIcon;
  path: string;
  plane?: AppPlane | "both"; // default "both" (omit = both planes)
  requiredPermission?: string; // e.g. "workflows:read"
};
type NavGroup = {
  title: string;
  items: NavItem[];
  plane?: AppPlane | "both";
};

function filterNavGroupsByRole(
  groups: NavGroup[],
  isAdmin: boolean,
  plane: AppPlane,
  permissions: string[],
): NavGroup[];
```

Filtering rules, applied in order:

1. Drop a **group** whose `plane` is set and doesn't match the current
   `plane` (and isn't `"both"`).
2. Within a surviving group, drop an **item** whose `plane` mismatches the
   same way.
3. If an item declares `requiredPermission`, keep it only if `permissions`
   satisfies it — directly, or via the `<resource>:manage` wildcard (e.g.
   `agents:manage` satisfies a `agents:read` requirement; see `satisfies()`
   in `navigation.config.ts`, mirroring `evaluateCan` in `useMyPermissions`).
4. An item with **no** `requiredPermission` that sits in a platform-plane
   group/item (e.g. every item under **Administration**, and `Providers`)
   falls back to the legacy `isAdmin` gate — so an ungated admin surface is
   never exposed to a non-admin just because it lacks an explicit
   permission string.
5. Drop any group left with zero items after filtering.

The **Administration** group (`Users`, `Budget`, `GitOps`, `Harnesses`,
`Audit`) is marked `plane: "platform"` in its entirety, so it disappears
whenever the active scope is anything other than the global root —
independent of the caller's admin/permission status. `Providers` is the one
Configuration-group item marked `plane: "platform"` (cross-tenant provider
config), while `Harnesses` is gated by plane rather than by a
`scopeNodeId` filter (see below) since the underlying resource isn't
scope-partitioned.

### `useEffectivePermissions` — real permissions, not the JWT role

`Sidebar.tsx`'s `useNavData` derives `plane = resolvePlane(activeScopeNodeId)`
from `useScopeContext()` and reads `permissions` from
`useEffectivePermissions()` (`apps/web/src/hooks/useEffectivePermissions.ts`)
before calling `filterNavGroupsByRole(NAV_GROUPS, isAdmin, plane,
permissions)`. `useEffectivePermissions` is a thin wrapper — it defaults
`scopeNodeId` to `useScopeContext().activeScopeNodeId` and delegates
everything else, including the `<resource>:manage` wildcard evaluation, to
the existing `useMyPermissions` hook (itself backed by
`GET /me/permissions?scopeNodeId=`). No permission logic is duplicated
between the two hooks — nav filtering always reflects the caller's actual
`role_assignments`-derived grants at the _active_ scope, not a coarse
`admin`/`user` JWT role.

### Backend default-deny: `ScopeAccessService.restrictToAccessibleScopes`

`apps/api/src/auth/authorization/scope-access.service.ts` adds a helper on
top of the existing `getAccessibleScopeIds` (see
[Subtree isolation](#subtree-isolation)):

```ts
async restrictToAccessibleScopes(
  userId: string,
  permissionName: string,
  requestedScopeId?: string,
): Promise<string[]> {
  const accessible = await this.getAccessibleScopeIds(userId, permissionName);
  if (!requestedScopeId) return accessible;
  return accessible.includes(requestedScopeId) ? [requestedScopeId] : [];
}
```

**Default-deny behavior:** no `requestedScopeId` → the caller's full
accessible set is returned (the list endpoint filters to it). A
`requestedScopeId` that is **not** in the accessible set returns `[]` — an
empty result, never a fallback to the full set and never the requested
(out-of-subtree) id. Spoofing a `scopeNodeId` query param outside your
subtree yields an empty list, not another tenant's rows.

> **Signature deviation, documented deliberately:** the canonical shorthand
> considered was `restrictToAccessibleScopes(userId, requestedScopeId?)`, but
> `getAccessibleScopeIds` cannot resolve an accessible set without a
> permission name to check against `role_permissions`. The implemented
> signature threads `permissionName` in as the middle argument instead of
> silently dropping default-deny correctness.

This is now **the required pattern for every new list endpoint**: inject
`ScopeAccessService`, resolve `userId` from `req.user`, call
`restrictToAccessibleScopes(userId, '<resource>:read', query.scopeNodeId)`,
and thread the returned id set into the repository query as a
`scope_id = ANY($scopeIds) OR scope_id IS NULL` filter (the `OR scope_id IS
NULL` keeps platform/global rows visible to any permission holder — mirror
`workflow.controller.ts findAll`, the original reference implementation).

**Applied to (primary list endpoints):**

| Endpoint                                             | Permission      |
| ---------------------------------------------------- | --------------- |
| `agent-profiles.controller.ts` list                  | `agents:read`   |
| `gitops.controller.ts` bindings list                 | `gitops:read`   |
| `variables.controller.ts` list                       | `settings:read` |
| `cost-governance.controller.ts` budget-policies list | `budgets:read`  |
| `users.controller.ts` list                           | `users:read`    |
| `providers.controller.ts` list                       | `agents:read`   |
| `secrets.controller.ts` list                         | `secrets:read`  |

The `users` list has an extra wrinkle: rather than adding scope columns to
the Kanban-neutral `users` table, a `scopeNodeId` request confines the
result to the union of **direct and inherited** `role_assignments` members
at that node (reusing the Phase 1 effective-members machinery — see
[Membership: direct vs. inherited](#membership-direct-vs-inherited)); the
full unscoped directory remains available only when no `scopeNodeId` is
supplied (the platform-plane "master directory" view).

**Deliberately NOT scoped** — investigated and confirmed non-scope-node
-partitioned, not merely skipped:

| Resource                                               | Why it's not filtered by `scope_node_id`                                                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Agent skills (`AgentSkillsController`)                 | Filesystem-backed skill library; its `SkillScope` field is an unrelated prompt-applicability concept, not the scope tree.       |
| Tools (`tool.controller.ts`)                           | Global tool-registry table (`tool-registry.entity.ts`) — no scope/owner column at all.                                          |
| Events (`EventLedgerController`)                       | Accepts only the neutral workflow `context.scopeId`; the multi-tenant `scopeNodeId` is hard-coded to `null` in the query build. |
| Schedules (`ScheduledJobsController`)                  | `scope` here is a pre-existing Kanban-project-vs-global axis on `scheduled_jobs`, unrelated to `scope_node_closure`.            |
| Memory segments (`MemoryExplorer`'s backing endpoints) | `scope` selects a memory-segment table (users/system/chat); no `scope_node_id` column exists on those tables.                   |
| Notifications (`NotificationInboxController`)          | Per-user inbox resolved from the JWT `sub`; no `scopeNodeId` param exists on the endpoint at all.                               |

### Web: the scope-aware list-page pattern

Every scope-aware list page follows one pattern — context in, query param
out, scope in the cache key:

```ts
const { activeScopeNodeId } = useScopeContext();
const response = await api.getAgentProfiles({ scopeNodeId: activeScopeNodeId, ... });
// the scope MUST be part of the queryKey so switching scope triggers a refetch:
queryKey={[...queryKeys.agents.all(), "paginated", activeScopeNodeId]}
```

Pages that genuinely send the active scope to their **list query** today —
verified component → hook → API client → request — are `Providers`,
`Secrets`, `VariablesEditorPage` (via `useScopedVariables`), `AuditLogPage`
(which seeds a `ScopeNodePicker` from the active scope and passes it as
`lockedScopeNodeId` to the event-ledger feed), `Workflows`, `AgentProfiles`,
and `BudgetPoliciesTab`/`BudgetPage`. For each, the active scope is threaded
into both the request's `scopeNodeId` param and the React Query `queryKey`,
so switching scope refilters the list.

`Workflows` needed a small backend addition alongside the frontend wiring:
`WorkflowController#findAll` previously called
`scopeAccess.getAccessibleScopeIds` directly (the full accessible set, not
narrowable to one node); it now calls `restrictToAccessibleScopes` with an
optional `scopeNodeId` query param, matching the pattern already used by
`agent-profiles`, `providers`, `budget-policies`, `gitops` bindings, `users`,
and `variables`. The pagination schema/DTO gained a `scopeNodeId` field to
carry it (`packages/core`'s `paginationQuerySchema`,
`apps/api/src/workflow/workflow.controller.dto.ts`). The pre-existing
"include descendants" checkbox on `Workflows`/`AgentProfiles` remains
**not** wired to the fetch — `restrictToAccessibleScopes` narrows to the one
requested node, not its subtree, and there's no established
multiple-scope-id list endpoint shape to extend; that's a separate,
still-open follow-up.

`GitOpsStatus` could not be wired the same way: `GET /gitops/status` has no
`scopeNodeId` query param and its reconciliation is genuinely
platform-wide (a single feed covers every scope's bindings and drift in one
call — unlike `GET /gitops/bindings`, which already accepts `scopeNodeId`
but is used only by the binding edit dialog, not this list). Instead, the
page now client-side re-filters **all** of `status.bindings` and
`status.drift` to the active scope (previously only `status.drift` reacted
to `activeScopeNodeId`; the bindings-derived panels — `GitOpsBindingsPanel`,
`GitOpsSyncStatusPanel`, `GitOpsPendingChangesPanel` — showed every scope's
bindings regardless), so switching scope now re-filters the whole page, just
without a network refetch.

`Users` needed **no change**: the users-table query only renders at the
global/platform scope (`Users.tsx` early-returns `<ScopeMembersPanel
scopeNodeId={activeScopeNodeId} />` for any non-global active scope), so
sending `scopeNodeId` to the master directory query would be a permanent
no-op — the non-global case is already covered by `ScopeMembersPanel`'s own
scoped effective-members query.

`ScopedConfigViewer` is a related but distinct case: it seeds the active
scope into a per-object **config-resolution** query
(`useResolvedAgentProfile`/`useResolvedWorkflow` keyed by `scopeNodeId`), not
a list query — its object-name pick-lists (`useAgentProfiles()`,
`useWorkflows()`) are unscoped. `HarnessesAdminPage` reads `activeScopeNodeId`
too, but only to gate itself by **plane** (a platform-only surface backed by
a non-scope-partitioned config resource), not to filter a query.

The six resources in the "deliberately NOT scoped" table above carry an
inline comment at their page entry point explaining why they were left out of
this rollout, so the reasoning survives without re-deriving it from the
Phase 5 task history.

**Explicitly out of scope (Kanban-owned surfaces):** `pages/projects/*`,
`pages/work-items/*`, `pages/sessions/*` may read `activeScopeNodeId` for
display, but scope _filtering_ for those surfaces stays Kanban-side per the
[Core/Kanban boundary](../../AGENTS.md#corekanban-boundary) — the API/core
layer never gains project-domain scope plumbing to support them.

## See also

- `apps/api/README.md` — short scope/auth summary for API contributors.
- `docs/guide/19-security.md` — JWT auth, scoped permissions, audit, secrets.
- `docs/plans/multi-tenant-phase-3-email-delivery.md` — Phase 3 implementation plan.
- `docs/plans/multi-tenant-phase-5-scope-framing.md` — Phase 5 implementation plan.
