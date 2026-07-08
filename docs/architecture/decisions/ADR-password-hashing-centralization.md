# ADR: Centralise Password Hashing Behind `PasswordHashingService`

**Status:** Accepted
**Date:** 2026-06-29
**Work item:** 50c4d74d-d38e-48c0-aa2c-bf9e4908ecd8 (child-3 of parent 63dc40e4)
**Owner:** bcrypt-centralization-refactor (child-3)
**Module:** `apps/api/src/auth/`
**Related docs:** `docs/analysis/bcrypt-call-site-audit.md`

> Status line (literal): `Status: Accepted`

## Context

Before this refactor, password hashing and verification were handled by
direct `bcrypt` imports scattered across the NestJS API. Two
service-layer files duplicate the same `import * as bcrypt from 'bcrypt'`
and inline the cost factor as the literal `12`:

- `apps/api/src/users/users.service.ts` — **four** legacy call sites
  (`create`, `createUser`, `resetPassword`, `validatePassword`).
- `apps/api/src/auth/auth.service.ts` — **two** legacy call sites
  (`register`, `login`), already migrated to
  `PasswordHashingService.hash(...)` / `.verify(...)` by child-2 but
  historically also inline `bcrypt.hash(...)` / `bcrypt.compare(...)`.

There is no shared abstraction; each call site re-imports `bcrypt`,
re-encodes the cost factor, and re-implements the `hash` / `compare`
shape. The duplication invites silent drift: a cost-factor bump, a
rehash-on-login hardening, or an algorithm swap (bcrypt → argon2) must
be applied to every site individually, and any missed site is a
silent inconsistency between stored hashes and the verifier used to
check them.

### Risk surface addressed

Three concrete risks are collapsed into one file by this refactor:

- **Cost-factor migration.** Today the literal `12` is hard-coded at
  six call sites; any future bump is a six-file edit. Centralising the
  cost factor behind a `ConfigService`-backed default
  (`PASSWORD_HASH_COST_FACTOR`, default `12`) reduces the migration to
  a single env-var change.
- **Password-rehash-on-login.** When the cost factor is bumped,
  hashes produced under the old factor need to be silently re-hashed
  on successful login. No call site today has access to a shared
  helper that knows both the verifier and the configured factor, so
  rehash-on-login cannot be implemented without first introducing the
  abstraction this ADR records.
- **Timing-attack mitigation.** `bcrypt.compare` is constant-time per
  the library contract, but call-site repetition makes it easy to
  introduce a non-constant-time shortcut (early-return on length
  mismatch, string comparison before hash verification). A shared
  `verify(plain, hashed)` method routes every comparison through the
  same boundary, making audit and future hardening a one-file change.

## Decision

All password hashing and verification in the NestJS API MUST go
through `PasswordHashingService` (defined at
`apps/api/src/auth/password-hashing.service.ts`). Direct
`import * as bcrypt from 'bcrypt'` outside of
`password-hashing.service.ts` is **forbidden**.

The service exposes two methods:

- `hash(plain: string): Promise<string>` — reads the cost factor from
  `ConfigService` (`PASSWORD_HASH_COST_FACTOR`, default `12`) and
  forwards to `bcrypt.hash`.
- `verify(plain: string, hashed: string): Promise<boolean>` — forwards
  to `bcrypt.compare`.

Consumers inject `PasswordHashingService` via the constructor and
call `this.passwordHashingService.hash(...)` / `.verify(...)`. The
six pre-migration call sites (four in `UsersService`, two in
`AuthService`) are replaced as follows:

| # | File | Method (pre-migration) | Pre-migration call | Post-migration call |
|---|------|------------------------|--------------------|---------------------|
| 1 | `apps/api/src/users/users.service.ts` | `create(input)` | `bcrypt.hash(input.password, 12)` | `this.passwordHashingService.hash(input.password)` |
| 2 | `apps/api/src/users/users.service.ts` | `createUser(createUserDto)` | `bcrypt.hash(createUserDto.password, 12)` | `this.passwordHashingService.hash(createUserDto.password)` |
| 3 | `apps/api/src/users/users.service.ts` | `resetPassword(...)` | `bcrypt.hash(newPassword, 12)` | `this.passwordHashingService.hash(newPassword)` |
| 4 | `apps/api/src/users/users.service.ts` | `validatePassword(plainPassword, user)` | `bcrypt.compare(plainPassword, user.passwordHash)` | `this.passwordHashingService.verify(plainPassword, user.passwordHash)` |
| 5 | `apps/api/src/auth/auth.service.ts` | `register(dto)` | `bcrypt.hash(dto.password, 12)` | `this.passwordHashingService.hash(dto.password)` |
| 6 | `apps/api/src/auth/auth.service.ts` | `login(dto)` | `bcrypt.compare(dto.password, user.passwordHash)` | `this.passwordHashingService.verify(dto.password, user.passwordHash)` |

The full pre/post migration matrix, including grep evidence and
the per-call child owner, is in
[`docs/analysis/bcrypt-call-site-audit.md`](../../analysis/bcrypt-call-site-audit.md).

## Alternatives

### Option 1 — Status quo (continue with direct `bcrypt` imports)

Keep the six direct `bcrypt.hash` / `bcrypt.compare` call sites and
the duplicated cost-factor literal.

Rejected because the duplication already bit us once (the cost
factor is repeated six times — any future bump is a six-file change,
not a one-file change) and rehash-on-login cannot be implemented
without an abstraction that knows both the verifier and the
configured factor. The grep audit in
`docs/analysis/bcrypt-call-site-audit.md` records the current
duplication; the DRY/KISS standard in this codebase flags it as the
threshold at which duplication stops being stylistic and starts
actively inviting silent drift.

### Option 2 — Switch to `argon2` instead of centralising `bcrypt`

Skip the centralisation and move all six sites to `argon2.hash` /
`argon2.verify` directly.

Rejected because (a) algorithm migration is an orthogonal axis to
the centralisation this ADR records — the right move is to centralise
the **existing** algorithm so the future algorithm swap is a
one-file change, not another six-file change; (b) `argon2` is not in
the API runtime's transitive dependency tree today, so the migration
requires a dependency-policy review, a `ConfigService` integration,
and a re-hash migration plan that is out of scope for this work
item. Tracked as a separate follow-up.

### Option 3 — Generic `CryptoService` covering hash + compare + sign + verify

Build a single generic `CryptoService` that owns bcrypt, HMAC, JWT
signing, and any future symmetric/asymmetric primitives, then route
all six sites through it.

Rejected because (a) the helpers it replaces (HMAC, JWT signing) already
have their own services (`TokenService`, `RefreshTokenService`,
`refresh-token-hash.util`) and combining them under one umbrella inverts
the per-concern module boundaries the project has deliberately
established; (b) the single-concern helper is the smallest unit that
resolves the duplication flagged by the audit — a generic
`CryptoService` would expand scope well beyond the password-hashing
risk surface; (c) the cost of a dedicated `PasswordHashingService` is
one extra file, which is the exact failure mode this refactor is
designed to reduce, not expand.

## Consequences

### Positive

- **Single-file cost-factor control.** The cost factor is read from
  `ConfigService` (`PASSWORD_HASH_COST_FACTOR`, default `12`) in
  exactly one place. A future bump is a single env-var change plus the
  (still one-place) rehash-on-login logic, not a six-file edit.
- **Single-place rehash-on-login.** When the cost factor is bumped,
  hashes produced under the old factor need to be silently re-hashed
  on successful login. `PasswordHashingService.verify` is the only
  call site the rehash-on-login logic must wrap.
- **Single-point algorithm swap.** Migrating from bcrypt to argon2 is
  a one-class change inside `PasswordHashingService`; the six
  consumers continue to call `hash(...)` / `verify(...)` with no
  signature churn.
- **Grep-auditable boundary.** The grep audit is expected to return
  exactly one match — `password-hashing.service.ts` — and any future
  drift is a single command away from being caught in CI.

### Negative / follow-ups

- **Env-var documentation in `validation.schema.ts` and `.env.example`.**
  `PASSWORD_HASH_COST_FACTOR` is read from `ConfigService` but is not
  yet documented in the env-var schema or `.env.example`. Tracked as a
  follow-up below.
- **Integration-test mocks still mock `bcrypt` directly.** The auth
  integration test module and mock factory under
  `apps/api/src/auth/__tests__/setup/` mock `bcrypt` via
  `vi.mock('bcrypt', ...)`. Unit tests already mock
  `PasswordHashingService` directly; the integration-test mock layer is
  the only remaining direct `bcrypt` mock and should be re-pointed at
  `PasswordHashingService` in a follow-up. Out of scope here.

## Follow-up

- **Env-var documentation.** Add `PASSWORD_HASH_COST_FACTOR` to
  `validation.schema.ts` and `.env.example`. Owner TBD.
- **Integration-test mock migration.** Re-point
  `apps/api/src/auth/__tests__/setup/auth-test.module.ts` and
  `auth-mocks.factory.ts` from the direct `vi.mock('bcrypt', ...)`
  to a `PasswordHashingService` mock. Owner TBD.

## Status

Status: Accepted. Owner: bcrypt-centralization-refactor (child-3).

The decision recorded here is that **every** password hash / verify
call site in the NestJS API MUST route through
`PasswordHashingService`, that direct `bcrypt` imports are forbidden
outside `password-hashing.service.ts`, and that the configured cost
factor is read from `PASSWORD_HASH_COST_FACTOR` (default `12`). The
helper class is in place and registered as a provider in `AuthModule`
as of child-1; `AuthService` migration is complete as of child-2;
`UsersService` migration + this ADR are complete as of child-3.

## References

- `apps/api/src/auth/password-hashing.service.ts` — helper class (child-1).
- `apps/api/src/auth/auth.service.ts` — child-2 migration target.
- `apps/api/src/users/users.service.ts` — child-3 migration target.
- `apps/api/src/users/users.service.spec.ts` — child-3 spec target.
- `docs/analysis/bcrypt-call-site-audit.md` — pre/post migration matrix.