# Refresh-token HMAC deploy notes

## Summary

Refresh tokens are now hashed with deterministic HMAC-SHA-256 (server-side key)
instead of bcrypt. The new shape is indexable, which lets the refresh-token
exchange path satisfy lookups in O(1) via
`RefreshTokenRepository.findByTokenHash` instead of loading every row and
running `bcrypt.compare` in code on the most-used auth endpoint. The change
ships with a unique B-tree index (`UQ_refresh_tokens_token_hash`) that backs
the lookup. Because bcrypt is one-way and the previous column values are not
HMAC-compatible, **every pre-existing `refresh_tokens` row becomes
unreachable after deploy** — environments with legacy data must follow the
deploy procedure below.

## What changed

- **Hash algorithm:** `bcrypt(password)` → `HMAC-SHA-256(plainToken, REFRESH_TOKEN_HMAC_KEY)`.
  The HMAC is computed via `hashRefreshToken` in
  `apps/api/src/auth/refresh-token-hash.util.ts`.
- **Stored shape:** 64-char lowercase hex string (deterministic, indexable,
  exactly the length of a SHA-256 digest).
- **Lookup:** O(n) `bcrypt.compare` scan over `refresh_tokens` → O(1)
  `RefreshTokenRepository.findByTokenHash` equality lookup against the new
  index.
- **DB index:** new unique B-tree index
  `UQ_refresh_tokens_token_hash` on `refresh_tokens.token_hash`, added by
  migration
  `20260630000000-add-refresh-tokens-token-hash-unique-index.ts`. Uniqueness
  is a hard invariant: the hash is a pure function of `(secret, plainToken)`,
  so two rows with the same `token_hash` would represent the same credential
  written twice — the constraint is the right shape, not just a non-unique
  helper index.
- **Required env var:** `REFRESH_TOKEN_HMAC_KEY` — a 32+ byte secret, injected
  via the `REFRESH_TOKEN_HMAC_KEY` injection token in
  `apps/api/src/auth/refresh-token-key.provider.ts` and read by
  `RefreshTokenService` at request time.

## ⚠️ Breaking change

Existing `refresh_tokens` rows predate this change and store bcrypt digests in
`token_hash`. After deploy:

- The new code path computes
  `HMAC-SHA-256(plainToken, REFRESH_TOKEN_HMAC_KEY)` and compares it against
  `token_hash`.
- Bcrypt hashes in the column are **never equal** to any HMAC-SHA-256 hex
  digest, so every legacy row is unreachable — not "decryptable", not
  "rehashable in place". bcrypt is one-way; there is no migration that
  rewrites legacy rows to the new shape without forcing every affected user
  to re-authenticate.
- Affected users will hit `401 Unauthorized` on `POST /auth/refresh` and must
  re-authenticate. Active access tokens keep working until their own expiry;
  only the refresh path is broken for legacy rows.
- The new unique index migration itself is safe to apply against a table that
  already contains bcrypt hashes — bcrypt digests are non-deterministic, so
  duplicates should not exist and the index creation should succeed without
  truncating first. The unreachable-row problem only manifests at
  refresh-token lookup time, not at migration time.

## Required deploy steps

For environments with existing `refresh_tokens` data, in order:

1. **Announce** the change to users in advance. Every active refresh token
   will be invalidated by the deploy — sessions survive only until their
   access token expires (typically short-lived) and then fail until the user
   re-authenticates.
2. **Decide** between two paths:
   - **a. Truncate path (clean break):**
     `TRUNCATE TABLE refresh_tokens;` — every active session ends at the
     next refresh attempt. Pairs naturally with a planned maintenance
     window or a coordinated logout-everyone event.
   - **b. Soft path (no manual SQL):** leave rows in place; users re-auth
     naturally as their access tokens expire. The legacy rows are
     unreachable but harmless — they are simply never matched. The
     `UQ_refresh_tokens_token_hash` migration will not collide because
     bcrypt hashes are non-deterministic. A periodic
     `DELETE FROM refresh_tokens WHERE created_at < now() - interval '7 days';`
     cleanup can sweep the dead rows after a short grace window.
3. **Set** `REFRESH_TOKEN_HMAC_KEY` in the deploy environment to a 32+ byte
   secret. Recommended generation:
   ```bash
   openssl rand -hex 32
   ```
   (64 hex chars / 32 bytes is the canonical form; any 32+ byte string is
   accepted.) Apply via your standard secret-management process — do not
   commit the value. Rotating the secret re-invalidates every active
   refresh token, so coordinate with users (see "Key rotation" below).
4. **Deploy** the API and run migrations. Order matters less here: the
   migration creates an empty index that gets populated by the first
   HMAC-hashed token issued after deploy. The API refuses to start if
   `REFRESH_TOKEN_HMAC_KEY` is missing or shorter than 32 bytes.
5. **Monitor** `POST /auth/refresh` 401 rate for the first hour after
   deploy — expect a spike proportional to active sessions on the soft
   path, or near-zero on the truncate path (which would instead show
   re-login volume on `POST /auth/login`).

## Why bcrypt was replaced

- bcrypt is intentionally non-deterministic (per-row salt), so the same
  plain token produces a different digest every round. A B-tree index on
  `token_hash` is useless against a salted hash: every refresh required
  loading every row and doing a CPU-expensive `bcrypt.compare` in code.
- HMAC-SHA-256 with a server-side secret is deterministic and cheap. The
  same plain token always hashes to the same digest, so the DB index can
  satisfy the lookup in O(log n) — and with the unique constraint, the
  matching row is at most one.
- This was a critical perf/security hotspot on the most-used auth path.
  Refresh tokens are minted on every login and verified on every silent
  re-auth; an O(n) scan over a growing table is a DoS-shaped problem
  even at modest scale.
- HMAC-SHA-256 remains safe because the secret never leaves the server.
  An attacker who exfiltrates only the `refresh_tokens` table cannot
  reverse hashes back to plain tokens without the secret, and the secret
  is not stored alongside the hash. The threat model is "DB read" → still
  infeasible without the env var.

## Key rotation

If `REFRESH_TOKEN_HMAC_KEY` ever needs to be rotated:

- Existing tokens become unreachable (their hashes are no longer the
  hashes the new code path computes). This is identical to the initial
  deploy from the user's perspective.
- The migration path is identical to the initial deploy: announce →
  deploy → let users re-auth on the soft path, or truncate first on the
  truncate path.
- For **zero-downtime rotation**, run a parallel key: keep the old key in
  a future `REFRESH_TOKEN_HMAC_KEY_PREVIOUS` env var and the new key in
  `REFRESH_TOKEN_HMAC_KEY`. The service would try the new key first on
  lookup, fall back to the previous key on miss, and rehash any row it
  finds under the previous key on next rotation. **This is out of scope
  for the initial PR** — track as a follow-up if/when a rotation event
  is actually scheduled.

## Files changed in this PR

- `apps/api/src/auth/refresh-token.service.ts` — replaced bcrypt hash + O(n)
  scan with HMAC + O(1) `findByTokenHash` lookup.
- `apps/api/src/auth/refresh-token.service.spec.ts` — updated tests to mock
  the HMAC key provider and assert `findByTokenHash` is called.
- `apps/api/src/auth/auth.service.ts` — adapted to the new return shape of
  `RefreshTokenService.validateRefreshToken`.
- `apps/api/src/auth/__tests__/unit/token.service.spec.ts` — adapted to the
  new return shape.
- `apps/api/src/auth/refresh-token-hash.util.ts` — HMAC helper utility
  (existing in this PR, unchanged from prior).
- `apps/api/src/auth/refresh-token-key.provider.ts` — NestJS DI provider for
  the `REFRESH_TOKEN_HMAC_KEY` injection token (existing in this PR,
  unchanged from prior).
- `apps/api/src/database/migrations/20260630000000-add-refresh-tokens-token-hash-unique-index.ts`
  — new migration that adds the unique B-tree index
  `UQ_refresh_tokens_token_hash` on `refresh_tokens.token_hash`.
- `apps/api/src/database/migrations/registered-migrations.ts` — registers
  the new migration in the active registry.

## Related reference

- Migration JSDoc — same warning, in-file:
  `apps/api/src/database/migrations/20260630000000-add-refresh-tokens-token-hash-unique-index.ts`
- `.env.example` — line 88: `REFRESH_TOKEN_HMAC_KEY=`
- Auth security overview: `docs/guide/19-security.md`
