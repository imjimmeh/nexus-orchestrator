---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: oauth-redis-durable-session
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/oauth/oauth-login-session.store.ts
  - apps/api/src/oauth/oauth-login-session.store.spec.ts
  - apps/api/src/oauth/oauth-login-session.bus.ts
  - apps/api/src/oauth/oauth-login-session.bus.spec.ts
  - apps/api/src/oauth/oauth-login-session.bus.service.ts
  - apps/api/src/oauth/oauth-login.integration.spec.ts
  - apps/api/src/oauth/oauth-login.service.ts
  - apps/api/src/oauth/oauth.module.ts
  - apps/api/src/redis/redis-pubsub.service.ts
  - docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md
source_paths:
  - apps/api/src/oauth/oauth-login-session.store.ts
  - apps/api/src/oauth/oauth-login-session.store.spec.ts
  - apps/api/src/oauth/oauth-login-session.bus.ts
  - apps/api/src/oauth/oauth-login-session.bus.spec.ts
  - apps/api/src/oauth/oauth-login-session.bus.service.ts
  - apps/api/src/oauth/oauth-login.integration.spec.ts
  - apps/api/src/oauth/oauth-login.service.ts
  - apps/api/src/oauth/oauth.module.ts
  - apps/api/src/redis/redis-pubsub.service.ts
updated_at: 2026-07-02
---

# Probe Result: OAuth Redis-Durable Session (53b39246 refactor)

## Narrative Summary

The `oauth-redis-durable-session` scope is **fully implemented** end-to-end.
Work item `53b39246-24df-4565-bd90-f468e0fd16cd` ("Distribute OAuth Login
Session State Through Redis + Pub/Sub") has landed every milestone described
in `docs/architecture/decisions/ADR-oauth-login-session-state-distribution.md`.
The `OAuthLoginService` no longer holds all in-flight session state in a
per-pod `Map`; the durable half (id, status, modality, codes, expiresAt,
error) is persisted in Redis under `oauth:session:{sessionId}` with a
900-second `SET ... EX` TTL, and the cross-pod manual-code delivery is
routed through a new `OAuthLoginSessionBus` port backed by the existing
`RedisPubSubService` on channel `oauth:session:{sessionId}:code`. The
transient half (per-session `AbortController`) stays in a per-pod
`Map<string, { abortController }>` because it cannot be serialised. The
in-process `CLEANUP_INTERVAL_MS` `setInterval` reaper is gone — Redis TTL
is now the only clock. All nine source files listed in the probe scope
exist, are behaviour-bearing (not stubs), and are wired through
`OAuthModule` to the real `RedisModule`. Test coverage spans unit
(`*.spec.ts` siblings), DI smoke (`oauth.module.smoke.spec.ts`), service
behaviour with in-memory fakes (`oauth-login.service.spec.ts`,
`oauth-login.service.spec-helpers.ts`), and real-Redis cross-pod
integration (`oauth-login.integration.spec.ts`, gated on
`process.env.REDIS_HOST`).

This probe supersedes the durable / transient / bus half of the previous
parent artifact at `docs/project-context/probe-results/oauth-login-service.md`,
which still describes the pre-refactor `SESSION_TTL_MS` /
`CLEANUP_INTERVAL_MS` / `Map<string, LoginSession>` shape; that doc is
now stale w.r.t. the durable store and should be treated as historical.

## Per-file Contribution

- **`apps/api/src/oauth/oauth-login-session.store.ts`** (97 lines) exports
  `OAuthLoginSessionStore` (`@Injectable()`). Owns the
  `oauth:session:{sessionId}` Redis namespace, default
  `DEFAULT_TTL_SECONDS = 900` (matches the legacy
  `OAuthLoginService.SESSION_TTL_MS`), and exposes four methods:
  - `put(sessionId, durable, ttlSeconds?)` — `SET key value EX ttlSeconds`,
    refreshing the TTL on every call so an actively-progressing session
    never expires mid-flow.
  - `get(sessionId)` — `GET` + `JSON.parse`; returns `null` for missing /
    expired keys.
  - `delete(sessionId)` — `DEL`; no-op when already gone. Used on
    terminal `connected` / `failed` / `expired` transitions.
  - `expireAt(sessionId)` — `PTTL` + `Date(Date.now() + ttlMs)`; returns
    `null` for `pttl === -1` (no TTL) or `pttl === -2` (key gone).
    Constructor injects `Redis` via `@Inject(REDIS_CLIENT)`. Class-level
    JSDoc explicitly cites the ADR and the durable / transient split.

- **`apps/api/src/oauth/oauth-login-session.store.spec.ts`** (170 lines)
  is the unit suite. Covers `put` (default 900s TTL, custom TTL override,
  TTL-refresh-on-every-call, namespace isolation), `get` (missing → null,
  JSON round-trip, `expiresAt` preservation), `delete` (removal + safe
  no-op on missing), and `expireAt` (pttl -1 / -2 / absolute-time
  computation). Uses a hand-rolled `redisMock` against `REDIS_CLIENT`
  with no real Redis dependency, mirroring the
  `runner-config-store.service.spec.ts` harness pattern.

- **`apps/api/src/oauth/oauth-login-session.bus.ts`** (24 lines) is the
  port module anchor — a thin re-export of the `OAuthLoginSessionBus`
  interface and the `OAUTH_LOGIN_SESSION_BUS` token from
  `./oauth-login.types`. File-level JSDoc notes the "concrete Redis
  pub/sub implementation lands in M2" history; that implementation is
  now present in `oauth-login-session.bus.service.ts`, so this anchor is
  the only remaining piece of the M2 module surface (mirrors the
  `*-session.store.ts` / `*.types.ts` split).

- **`apps/api/src/oauth/oauth-login-session.bus.service.ts`** (143 lines)
  exports `OAuthLoginSessionBusService` (`@Injectable()`,
  `implements OAuthLoginSessionBus`), the concrete Redis-backed bus
  implementation. Routes manual-code delivery through channel
  `oauth:session:{sessionId}:code` (channel name assembled by
  `buildCodeChannel()` so publish and subscribe cannot drift). Accepts
  both JSON strings (test/standalone usage) and pre-parsed objects
  (the shape `RedisPubSubService.subscribeToRawChannel` delivers in
  production). The `parseEnvelope` / `extractCode` pipeline handles
  malformed JSON, non-object envelopes, missing / wrong-typed `code`
  fields, and unsupported payload types — all of which log a warning
  and drop the message (mirrors the upstream "never crash the message
  dispatcher" semantic). Lifecycle is delegated to the caller: the
  bus does not own unsubscribe cadence.

- **`apps/api/src/oauth/oauth-login-session.bus.spec.ts`** (192 lines)
  is the unit suite. Covers `subscribeToCode` (channel namespace,
  JSON-string happy path, pre-parsed object happy path, malformed-JSON
  rejection, missing-code rejection, wrong-typed-code rejection,
  unsupported-payload rejection, channel-per-sessionId isolation) and
  `publishCode` (envelope shape `{ code }`, channel namespace, return
  value). Mocks `RedisPubSubService` directly via a typed-cast object —
  no Redis required.

- **`apps/api/src/oauth/oauth-login.integration.spec.ts`** (335 lines)
  is the **real-Redis** cross-pod suite. Gated on
  `process.env.REDIS_HOST`; when missing, the entire `describe.skip`s
  so CI unit jobs run cleanly. Each test uses
  `crypto.randomUUID()` for a unique `sessionId` and appends to
  `cleanupSessionIds` for the `afterEach` `DEL` pass. Five scenarios:
  1. **Cross-pod `submitCode` delivery** — two `OAuthLoginService`
     instances (pod A + pod B) backed by the same real store + bus;
     pod B publishes `PASTED_CODE_123` and pod A's
     `provider.login` resolves, `sink` receives `CREDS`, and both pods
     observe `status === 'connected'` via Redis. Uses
     `vi.waitFor(..., { timeout: 5_000 })` for the async timing.
  2. **900-second TTL enforcement** — `sharedStore.expireAt(sessionId)`
     returns an absolute `Date` within ±5 s of `now + 900_000`.
  3. **Orphan recovery** — seeds a durable `pending` record with
     `expiresAt > now`, calls `getStatus` on a fresh pod whose
     transient map is empty, asserts the response is
     `{ status: 'failed', error: 'OAuth session orphaned by pod
restart' }`, and asserts the Redis key is `DEL`'d.
  4. **Expired-state transition** — seeds `expiresAt < now`, asserts
     `getStatus` returns `{ status: 'expired' }` and the key is
     `DEL`'d before the 900s TTL reap fires.
  5. **Static `setInterval` absence check** — reads
     `oauth-login.service.ts` from disk and asserts it does not
     contain `setInterval` or `cleanupExpired` (the legacy reaper
     naming convention), giving a durable regression guard against
     re-introducing the in-process cleanup loop.

- **`apps/api/src/oauth/oauth-login.service.ts`** (290 lines) is the
  refactored orchestrator. The single `Map<string, LoginSession>` field
  has been split:
  - `private readonly transient = new Map<string, { abortController:
AbortController }>()` — per-pod, holds only the unsserialisable
    primitive. The `submitManualCode` resolver is no longer stored
    here at all; it lives on a Promise captured in `start()`'s local
    scope (resolved via `sessionBus.subscribeToCode`).
  - Durable half is read / written exclusively via
    `OAUTH_LOGIN_SESSION_STORE` (`OAuthLoginSessionStore`).
  - `start()` writes the initial `pending` record _before_ anything
    else, then synchronously calls `sessionBus.subscribeToCode(...)`
    — this is the "publish-before-subscribe race guard" the ADR
    documents; any `submitCode` publish that lands on the very next
    tick is delivered to the already-registered subscriber.
  - `submitCode(sessionId, code)` reads the durable record (404 if
    missing; 400 if not `pending`) then publishes via the bus; the
    owning pod's subscriber resolves the manual-code Promise, the
    in-flight `provider.login` Promise resumes, the sink receives
    `CREDS`, and the durable record transitions to `connected`.
  - `getStatus(sessionId)` has three deterministic branches:
    missing → `NotFoundException`;
    `pending` + `expiresAt < now` → `{ status: 'expired' }` and `DEL`;
    `pending` + no transient half + `expiresAt > now` (orphan) →
    `{ status: 'failed', error: 'OAuth session orphaned by pod
restart' }`, write the failed record for audit, then `DEL`.
  - The `CLEANUP_INTERVAL_MS` `setInterval` reaper is gone; the only
    timer remaining is the `INITIATION_TIMEOUT_MS = 20_000`
    `setTimeout` guard inside `start()` (and it is cleared in
    `finally` once initiation settles, so a healthy session is never
    aborted while the user is still completing the browser login).

- **`apps/api/src/oauth/oauth.module.ts`** (44 lines) wires the new
  pieces. Imports `RedisModule` (a hard dependency at startup —
  documented in the module-level JSDoc and a recorded consequence of
  the ADR). Providers:
  - `OAuthLoginService`
  - `OAuthLoginSessionStore`
  - `OAuthLoginSessionBusService`
  - `OAUTH_PROVIDER_RESOLVER → useClass: PiAiOAuthProviderResolver`
  - `OAUTH_LOGIN_SESSION_STORE → useExisting: OAuthLoginSessionStore`
    (so callers can inject by token and receive the concrete class)
  - `OAUTH_LOGIN_SESSION_BUS → useExisting: OAuthLoginSessionBusService`
    Exports: `OAuthLoginService`, the three injection tokens. The
    `oauth.module.smoke.spec.ts` DI test (already pre-existing for M4)
    compiles the module with `RedisModule` overridden by a `redisStub`
    and `RedisPubSubService` overridden by a `pubSubStub`, then asserts
    every provider resolves and the new tokens resolve to the
    production classes.

- **`apps/api/src/redis/redis-pubsub.service.ts`** (139 lines) is the
  pre-existing pub/sub service the new bus builds on; this probe
  scope does not require changes to it, but the bus service relies on
  three of its methods: `publishToChannel(channel, payload)`,
  `subscribeToRawChannel(channel, callback)`, and
  `unsubscribeFromRawChannel(channel, callback)`. All three already
  have unit-test coverage in
  `apps/api/src/redis/redis-pubsub.service.spec.ts`.

## Capability Updates

- **Cross-pod OAuth login sessions (new capability, fully shipped).**
  The combination of `OAuthLoginSessionStore` (durable half, Redis
  `SET ... EX 900` under `oauth:session:{sessionId}`) and
  `OAuthLoginSessionBusService` (transient half, Redis pub/sub on
  `oauth:session:{sessionId}:code`) makes `OAuthLoginService`
  horizontal-scale-safe and pod-restart-safe. A login started on pod
  A is observable on pod B and the `submitCode` request delivered to
  pod B reaches pod A's in-flight `provider.login` Promise. A pod
  restart no longer produces a silent stuck session; it produces a
  deterministic `{ status: 'failed', error: 'OAuth session orphaned
by pod restart' }` that callers polling `getStatus` observe on the
  next request, and the orphaned Redis key is `DEL`'d immediately
  rather than waiting for the 900-second TTL clock.
- **OAuth login is now Redis-hard-required.** `OAuthModule` imports
  `RedisModule`, and `OAuthLoginService` cannot be constructed
  without `OAUTH_LOGIN_SESSION_STORE` and `OAUTH_LOGIN_SESSION_BUS`.
  This is an acceptable blast radius because Redis is already
  required by BullMQ, telemetry, runner-config, agent-response, and
  memory-eviction stores in the same API service.
- **Bus port + injection-token pattern (port + adapter).** The
  `OAuthLoginSessionBus` interface in `oauth-login.types.ts` is a
  proper Hexagonal-architecture port; the Redis-backed adapter
  (`OAuthLoginSessionBusService`) is bound through the
  `OAUTH_LOGIN_SESSION_BUS` symbol token. This is what makes the
  cross-pod bug regression test in
  `oauth-login.service.spec.ts` possible (it injects an
  in-memory `InMemoryOAuthLoginSessionBus` and proves the same
  shape works without Redis).
- **Schema migration to `@nexus/core/schemas/oauth`.** The
  `OAuthLoginSessionDurable` alias in `oauth-login.types.ts` is now a
  backward-compat alias for the canonical `OAuthSessionState`
  re-exported from `@nexus/core/schemas/oauth`. New code is
  expected to use `OAuthSessionState`; the alias is preserved for
  older consumers inside the API. This is the durable-half type
  source of truth for the store, the bus, and the service alike.

## Health Findings

- **Test coverage is comprehensive across all four scopes.**
  - Unit: `oauth-login-session.store.spec.ts` (17+ assertions on the
    store surface), `oauth-login-session.bus.spec.ts` (8 assertions
    on the bus adapter), `oauth-login.service.spec.ts` (10 scenarios
    including the cross-pod regression test that uses two harnesses
    sharing the same in-memory store + bus pair), and
    `oauth.module.smoke.spec.ts` (DI wiring smoke for M4).
  - Integration (real Redis, gated on `REDIS_HOST`):
    `oauth-login.integration.spec.ts` covers cross-pod delivery,
    900s TTL enforcement, orphan recovery, expired-state transition,
    and the static `setInterval`-absence check.
- **No `setInterval` / `CLEANUP_INTERVAL_MS` anywhere in the OAuth
  package.** A repo-wide grep on `apps/api/src/oauth/` returns only
  the integration spec's negative-assertion line
  (`expect(source).not.toMatch(/setInterval/)`); the source itself
  has no match. This is the durable regression guard the ADR
  promises.
- **Deterministic test helpers.** `oauth-login.service.spec-helpers.ts`
  ships `InMemoryOAuthLoginSessionStore` (TTL-on-read eviction,
  `peek()` for assertions without triggering eviction) and
  `InMemoryOAuthLoginSessionBus` (synchronous publish-then-resolve so
  the cross-pod test can verify delivery in-process). The
  non-async-but-Promise-returning shape is deliberately chosen so the
  helper satisfies `@typescript-eslint/require-await` while keeping
  test timing deterministic. The rationale is documented in the
  helper file's module-level comment.
- **Module-boundary hygiene.** The store and bus both use
  `@Inject(REDIS_CLIENT)` and constructor injection of
  `RedisPubSubService` — no global state, no `redis` import from
  outside `apps/api/src/redis/redis.module.ts`. The module-level
  JSDoc on `OAuthModule` explicitly records the new Redis dependency.
- **No new migrations, no new entities, no new cron jobs.** The ADR
  compares this favourably against Option 2 (Postgres entity +
  migration + cron); the implementation honours that decision
  exactly. Blast radius is contained to `apps/api/src/oauth/` and
  the existing `RedisModule` wiring.

## Open Questions

- **BullMQ worker migration (deferred per ADR Follow-up).** True
  restart-and-resume of the in-flight `provider.login` Promise is
  not delivered by this refactor; pod-restart sessions still fail,
  they just fail loudly with a recognisable error message. The ADR
  records this as Alternative 4 deferred; the durable Redis shape
  is the substrate the future BullMQ worker will checkpoint into.
  Owner TBD in the ADR.
- **`session_taken_over_at` audit field (deferred per ADR
  Follow-up).** No audit signal is recorded when a session's
  transient half is rebound (orphan recovery, test-time
  kill-and-republish). The ADR proposes adding a timestamp to the
  durable record, surfaced via `getStatus`. Owner TBD.
- **`nexus_oauth_login_orphaned_total` Prometheus counter (deferred
  per ADR Follow-up).** Today the orphan-recovery path is silent in
  dashboards; it shows up as `getStatus → failed`, indistinguishable
  from a provider-side error. The ADR proposes a dedicated counter
  following the `BackendInstrumentation` pattern. Owner TBD, picked
  up alongside the BullMQ follow-up.
- **Pre-existing `oauth-login-service.md` artifact is now stale.**
  That probe result describes the pre-refactor `SESSION_TTL_MS`,
  `CLEANUP_INTERVAL_MS`, and `Map<string, LoginSession>` shape.
  This artifact supersedes the durable / transient / bus half of
  it; a follow-up edit to `oauth-login-service.md` should
  cross-reference this artifact and remove the stale descriptions of
  the now-removed `CLEANUP_INTERVAL_MS` reaper.
