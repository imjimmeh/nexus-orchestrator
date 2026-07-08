# ADR-20260704: JWT Access-Expiry Single Source of Truth

**Status:** Accepted
**Date:** 2026-07-04
**Work item:** d50f07f7-fdc7-4fb7-ae04-27358a055b39
**Owner:** jwt-expiry-single-source-of-truth (child-3 of parent 0c0fa9fb-f5e7-4dc2-9a9f-f2f3955e0903)
**Module:** `apps/api/src/auth/`
**Related docs:** `apps/api/src/auth/auth.module.ts`, `apps/api/src/auth/token.service.ts`, `apps/api/src/config/duration.ts`, `apps/api/src/config/validation.schema.ts`, `docs/architecture/decisions/ADR-duration-parser-consolidation.md`

> Status line (literal): `Status: Accepted`

## Context

The JWT access-token expiry was previously governed by two co-existing
defaults living in different files, with no single source of truth.
The drift was surfaced by a parent work-item scan
(`0c0fa9fb-f5e7-4dc2-9a9f-f2f3955e0903`) and quantified as follows:

| Location                                                    | Default                              | Source of value                                                                              | Failure mode on direct `jwtService.sign(payload)`       |
| ----------------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `apps/api/src/auth/auth.module.ts` — `JwtModule.registerAsync` `useFactory` (module-level `signOptions`) | `'1h'` (hardcoded literal) | Module-level factory, *not* `ConfigService`                                                 | A bare `jwtService.sign(payload)` call would emit a **1-hour** token silently |
| `apps/api/src/auth/token.service.ts` — `generateTokens` (`signOptions.expiresIn` override) | `JWT_ACCESS_EXPIRY` from `ConfigService`, default `'15m'` (Zod-validated) | `ConfigService.get('JWT_ACCESS_EXPIRY', '15m')` — but in pre-refactor code, the per-call override was passed *only* here, not at the module level | A direct `jwtService.sign(payload)` call from any other file would silently emit a **1-hour** token |

The `JWT_ACCESS_EXPIRY` env var is declared in
`apps/api/src/config/validation.schema.ts` as
`z.string().default('15m')`, so the validated contract is **15 minutes**.
A bare `jwtService.sign(payload)` invocation anywhere in the auth
boundary would silently honour the module-level `1h` default and emit a
token whose `exp` claim was four times longer than the validated env
contract said it should be. The drift was structural: the `15m` value
lived in `TokenService.generateTokens`'s per-call override, the `1h`
value lived in `JwtModule.registerAsync`'s `signOptions`, and a future
code path that called `jwtService.sign(payload)` without re-implementing
the per-call override would silently produce the wrong token lifetime.

Two operational risks follow from this dual-default shape:

- **Silent contradiction with the validated env contract.** Operators
  setting `JWT_ACCESS_EXPIRY=15m` (the validated default) would see
  tokens that ignore their setting for any new sign site that forgot
  the per-call override. The setting looked honoured by the only call
  site that re-read it.
- **Drift invitation.** The `parseExpiryToSeconds` helper in
  `TokenService` was a hand-rolled second copy of the
  `parseDurationToSeconds` canonical utility that already existed at
  `apps/api/src/config/duration.ts` (per
  `ADR-duration-parser-consolidation.md`, child-1 of the parent work
  item). Two duration parsers plus two expiry defaults compounded the
  drift surface: the per-call override used one parser, the
  module-level factory used the other, and any future audit had to
  reconcile both.

The parent work item's child-1 milestone shipped
`parseDurationToSeconds` as the canonical duration parser and
migrated `TokenService.parseExpiryToSeconds` to delegate to it; this
ADR records the **companion** milestone that collapses the two expiry
defaults into a single canonical location, so the
`'15m'` value is sourced from exactly one place
(`ConfigService` / `validation.schema.ts`) and the redundant per-call
override is removed.

## Decision

The JWT access-token expiry is governed by a **single canonical
default**: the `JWT_ACCESS_EXPIRY` env var (Zod-validated default
`'15m'`), read from `ConfigService` exactly once at the
`JwtModule.registerAsync` useFactory in `auth.module.ts`. The
module-level `signOptions.expiresIn` is the **single source of truth**;
the redundant per-call override in `TokenService.generateTokens()` is
removed. The hand-rolled `TokenService.parseExpiryToSeconds()` is
replaced by the shared `parseDurationToSeconds` helper from
`apps/api/src/config/duration.ts`.

Concretely:

- `apps/api/src/auth/auth.module.ts` — the `JwtModule.registerAsync`
  `useFactory` now reads
  `configService.get<string>('JWT_ACCESS_EXPIRY', '15m')` and forwards
  it as `signOptions.expiresIn`. The hardcoded `'1h'` literal is gone;
  the factory now honours the validated env contract.
- `apps/api/src/auth/token.service.ts` — `generateTokens` calls
  `this.jwtService.sign(payload)` **without** a per-call
  `expiresIn` override. The module-level default governs the lifetime;
  `TokenService` no longer needs to re-derive the value. The
  hand-rolled `parseExpiryToSeconds` is deleted in favour of the
  shared `parseDurationToSeconds` helper (already imported for the
  response payload's `expiresIn` field).
- `apps/api/src/config/validation.schema.ts` — unchanged. The Zod
  schema continues to declare `JWT_ACCESS_EXPIRY:
  z.string().default('15m')`; this ADR records that the schema is
  now the **single canonical source** for the default value (rather
  than one of two competing literals).
- `apps/api/src/auth/refresh-token.service.ts` — **unaffected.** The
  refresh-token path uses the separate `JWT_REFRESH_EXPIRY` env var
  and its own service; this ADR does not touch it.

The `readAccessExpiry()` helper on `TokenService` is preserved as a
private method that reads `JWT_ACCESS_EXPIRY` from `ConfigService`
(falling back to `'15m'` when unset), so the **response payload's**
`expiresIn` field — which surfaces the resolved lifetime to the
client — continues to honour the same env var. The only thing
removed is the **per-call `expiresIn` override** passed into
`jwtService.sign(payload)`; the read-side computation of the
response field is unchanged.

## Alternatives

### Option 1 — Drop `signOptions.expiresIn` from the `JwtModule` entirely

Remove the `signOptions.expiresIn` field from
`JwtModule.registerAsync`'s `useFactory` result and rely on every
`jwtService.sign(payload)` caller to pass an explicit `expiresIn`.

Rejected because:

1. **A bare `jwtService.sign(payload)` would emit a token with no
   `exp` claim.** That is strictly worse than the previous
   silent-1h behaviour: a token with no `exp` is valid forever
   unless the verifier enforces an external expiry, which the
   current `JwtStrategy` does not. Removing `signOptions.expiresIn`
   entirely turns "wrong default" into "no default at all", which
   is a security regression.
2. **Every sign site becomes load-bearing.** Today the
   module-level default is the safety net; without it, every new
   `jwtService.sign(...)` call site must remember to pass
   `expiresIn` explicitly, and any site that forgets emits a
   non-expiring token rather than a wrong-length token. The
   drift moves from "1h vs 15m" to "infinite vs 15m", which is
   worse on every axis.
3. **The `TokenService.generateTokens` per-call override pattern
   was the precursor to this exact failure.** Removing the
   module-level default would re-establish the per-call-override
   pattern this refactor is designed to eliminate. The new
   contract — module-level default reads the canonical env var,
   per-call overrides only on intentional deviation — is the
   opposite of "every site must override".

### Option 2 — Keep the hardcoded `'1h'` as the module-level default

Retain the pre-refactor shape: module-level `signOptions.expiresIn:
'1h'`, per-call override in `TokenService.generateTokens()` for the
15-minute path.

Rejected because:

1. **The `'1h'` literal contradicts the validated env contract.**
   `validation.schema.ts` declares `JWT_ACCESS_EXPIRY` with a
   default of `'15m'`; the module-level `'1h'` is silently
   overriding that contract for any sign site that does not
   re-implement the per-call override. A new sign site that
   forgets to override produces a token with a 4× longer lifetime
   than the validated env contract says.
2. **The hardcoded value is not operator-tunable.** Operators who
   set `JWT_ACCESS_EXPIRY=30m` (a perfectly reasonable deviation)
   see the 15-minute value applied only at the `TokenService`
   call site; any future code path that calls
   `jwtService.sign(payload)` directly would emit a 1-hour token
   regardless of the env var. The operator-facing knob is
   structural-broken.
3. **The hardcoded value is invisible to the contract.** The Zod
   schema, the operator-facing `.env.example`, and the canonical
   duration-parser test suite all reference `'15m'`. The `'1h'`
   literal is the only place in the codebase that disagrees, and
   it is hidden inside `JwtModule.registerAsync`'s factory — the
   most grep-resistant location of the four. The dual-default
   shape is exactly the kind of drift that survives a code review.

### Option 3 — Migrate `parseExpiryToSeconds` only, leave the expiry defaults alone

Stop at the duration-parser consolidation: migrate
`TokenService.parseExpiryToSeconds` to delegate to
`parseDurationToSeconds`, but keep the module-level `'1h'` literal
and the per-call `'15m'` override in place.

Rejected because:

1. **Half a fix.** Removing the hand-rolled parser eliminates one
   axis of drift (the parser surface) but leaves the larger axis
   (the two competing expiry defaults) intact. An operator audit
   that catches the expiry-default drift still finds two literals
   to reconcile.
2. **The parser consolidation is meaningless if the two call
   sites disagree on what value to feed the parser.** Both
   `auth.module.ts` and `token.service.ts` would route through
   `parseDurationToSeconds`, but they would feed it different
   inputs (`'1h'` and `JWT_ACCESS_EXPIRY`/`'15m'` respectively).
   The canonical parser does not resolve the canonical-default
   drift; that requires collapsing the call sites.
3. **The two-call-site shape is exactly what
   `ADR-duration-parser-consolidation.md` rejected** in its own
   "Status quo / keep three parsers" alternative. Adopting the
   parser consolidation without the default consolidation
   reproduces the rejected shape on the value axis instead of
   the parser axis.

## Consequences

### Positive

- **Single canonical source for the access-token expiry default.**
  `JWT_ACCESS_EXPIRY` (Zod-validated, default `'15m'`) is the only
  source. The `'1h'` literal is gone. Operators who set the env var
  see their value applied to every `jwtService.sign(payload)` call
  site in the auth boundary, including future sites that have not
  yet been written.
- **Drift surface is collapsed to the env-var schema.** The
  expiry default now lives in exactly one place —
  `validation.schema.ts` — and any future audit that finds a
  competing literal is a single-grep failure mode, not a
  four-file reconciliation.
- **Per-call `expiresIn` overrides are reserved for intentional
  deviations.** Future JWT sign sites that intentionally deviate
  from the access-token policy (e.g. issuing short-lived
  password-reset tokens, 5-minute magic-link tokens, etc.) pass an
  explicit `expiresIn`. The default-override pattern is no longer
  required for correctness.
- **Duration-parser consolidation is complete.** The hand-rolled
  `TokenService.parseExpiryToSeconds` is gone;
  `parseDurationToSeconds` from `apps/api/src/config/duration.ts`
  is the canonical utility. Combined with
  `ADR-duration-parser-consolidation.md` (which recorded the
  migration of the parser itself, including the
  `refresh-token.service.ts` and `agent-token-ttl.ts` sites), the
  auth boundary is now grammar-consistent at both the parser and
  the default layers.

### Negative / follow-ups

- **Refresh-token default is unchanged by this ADR.** The
  `JWT_REFRESH_EXPIRY` env var (default 7 days) governs the
  refresh-token path, which uses a separate code path
  (`refresh-token.service.ts`). Operators who set
  `JWT_ACCESS_EXPIRY` and expect refresh tokens to track the
  same value will be surprised; the separation is intentional
  and matches the project's prior auth design, but it is worth
  surfacing in `.env.example` as a follow-up.
- **No new env var is introduced.** This ADR is a refactor, not
  a feature: the canonical value (`'15m'`) and the canonical
  env-var name (`JWT_ACCESS_EXPIRY`) are unchanged. Operators
  who currently rely on the silent-1h behaviour from a new sign
  site that did not implement the per-call override will now
  see 15-minute tokens from that site; this is the deliberate
  behaviour-fix.

## Follow-up

- **Regression test (`auth.module-jwt-expiry.spec.ts`).** A unit
  test guards against re-introducing the dual-default footgun by
  asserting that `JwtModule.registerAsync`'s `useFactory` reads
  `JWT_ACCESS_EXPIRY` from `ConfigService` (not a hardcoded
  literal) and that `TokenService.generateTokens` does not pass a
  per-call `expiresIn` override. The test fails loudly if either
  the `'1h'` literal or the per-call override is re-introduced.
- **`.env.example` documentation.** Confirm that
  `JWT_ACCESS_EXPIRY` is documented with its default value and a
  brief note that it governs the access-token expiry only (not
  refresh tokens). Owner: TBD.
- **Auth-module ADR cross-link.** Add a reference to this ADR
  from the auth-boundary documentation in
  `docs/guide/README.md` and from the auth-feature overview so
  future contributors find the single-source-of-truth contract
  without grep archaeology. Owner: TBD.

## Status

Status: Accepted. Owner:
jwt-expiry-single-source-of-truth (child-3 of parent
`0c0fa9fb-f5e7-4dc2-9a9f-f2f3955e0903`).

The decision recorded here is that **`JWT_ACCESS_EXPIRY` (Zod-
validated default `'15m'`) is the single canonical source** for the
JWT access-token expiry, that the module-level
`signOptions.expiresIn` in `JwtModule.registerAsync` reads it, that
the redundant per-call override in `TokenService.generateTokens()`
is removed, and that `TokenService.parseExpiryToSeconds` is
migrated to the shared `parseDurationToSeconds` helper from
`apps/api/src/config/duration.ts`. The refresh-token path is
governed by a separate `JWT_REFRESH_EXPIRY` env var and is
unaffected. The regression test
(`auth.module-jwt-expiry.spec.ts`) guards against the dual-default
shape being re-introduced.

## References

- `apps/api/src/auth/auth.module.ts` — `JwtModule.registerAsync`
  `useFactory`, the new single-source-of-truth read site.
- `apps/api/src/auth/token.service.ts` — `generateTokens`
  (no per-call override) and `readAccessExpiry` (preserved for
  the response payload's `expiresIn` field).
- `apps/api/src/config/duration.ts` — canonical
  `parseDurationToSeconds` utility.
- `apps/api/src/config/validation.schema.ts` — Zod-validated
  `JWT_ACCESS_EXPIRY: z.string().default('15m')` declaration.
- `apps/api/src/auth/refresh-token.service.ts` — the
  refresh-token path; governed by `JWT_REFRESH_EXPIRY`,
  intentionally out of scope for this ADR.
- `docs/architecture/decisions/ADR-duration-parser-consolidation.md`
  — the parent work item's child-1 ADR, which shipped the
  canonical `parseDurationToSeconds` utility; this ADR is its
  companion for the expiry-default layer.