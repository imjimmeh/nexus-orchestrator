# ADR: Distribute OAuth Login Session State Through Redis + Pub/Sub

**Status:** Accepted
**Date:** 2026-06-30
**Work item:** 53b39246-24df-4565-bd90-f468e0fd16cd
**Owner:** refactor-executor
**Module:** `apps/api/src/oauth/`
**Related docs:** `apps/api/src/oauth/oauth-login.service.ts`,
`apps/api/src/redis/redis-pubsub.service.ts`,
`docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`

> Status line (literal): `Status: Accepted`

## Context

`OAuthLoginService` (`apps/api/src/oauth/oauth-login.service.ts`) is the
single orchestrator that drives pi-ai SDK `OAuthProviderInterface.login`
for every supported provider and surfaces whichever modality the
provider chooses — device-code via `onDeviceCode`, authorization-code
via `onAuth` + manual paste / callback server. Minted credentials are
handed to a caller-supplied `OAuthSink`; the engine itself never
persists credentials.

The service currently keeps **all** in-flight login state in a single
private `Map<string, LoginSession>` field, scoped to the
`@Injectable()` instance:

```ts
private readonly sessions = new Map<string, LoginSession>();
```

This in-process `Map` has two correctness bugs that surface the
moment the API is run with `replicas > 1` — i.e., in every
production-like deployment, and in every load-test, today:

1. **Horizontal-scale break.** A login that is `start()`-ed on pod A
   (because the load-balancer routed `POST /oauth/start` to it) is
   unobservable on pod B. The follow-up `submitCode(sessionId, code)`
   request and the `getStatus(sessionId)` polling request land on a
   different pod with high probability — both raise
   `NotFoundException("OAuth session '...' not found")` because the
   `Map` lives in a different process. The user sees a
   "session not found" error mid-login even though the session is
   healthy and progressing; the device-code authorization on the
   provider's end still completes, but the API can never observe the
   `connected` status and never delivers the credentials to the
   caller. Today this is masked only because the production
   deployment runs a single replica.
2. **Pod-restart data loss.** The `Map` is per-pod, in-memory, and
   non-persistent. A pod restart (deploy, OOM, node drain) drops every
   in-flight login: the `AbortController` is GC'd, the
   `submitManualCode` Promise resolver is unreferenced, and the
   `provider.login` Promise is silently abandoned. Callers polling
   `getStatus` after a restart observe a `NotFoundException` (same
   symptom as the cross-pod case) and have no signal that the
   provider-side authorization is still pending. There is no surfaced
   "failed because the pod restarted" state, no recovery path, and no
   audit trail of how many sessions were lost.

The nightly `codebase_refactoring_analysis` scan flagged this pattern
under work item `53b39246-24df-4565-bd90-f468e0fd16cd`, and the
rationale from that scan is the canonical statement of why we are
distributing session state now.

## State Analysis

The `LoginSession` value held in the `Map` is a **hybrid** of durable
fields and transient runtime primitives. Concretely, the type is:

```ts
interface LoginSession {
  id: string;
  status: OAuthSessionStatusValue;
  modality?: OAuthModality;
  userCode?: string;
  verificationUri?: string;
  intervalSeconds?: number;
  authorizeUrl?: string;
  instructions?: string;
  error?: string;
  expiresAt: Date;
  abortController: AbortController;
  /** Resolves the SDK's manual-code / paste prompt once the user submits it. */
  submitManualCode?: (code: string) => void;
}
```

Splitting this into two halves is the analytical move that drives the
decision:

### Durable fields (serialisable, cross-pod-safe, must survive restart)

- `id`, `status`, `modality`, `userCode`, `verificationUri`,
  `intervalSeconds`, `authorizeUrl`, `instructions`, `error`,
  `expiresAt`. These are all primitives (or `Date`, which is a JSON-
  friendly timestamp). They describe the **observable state** of a
  login: what modality it uses, what the user is supposed to type /
  open, whether it has finished, and when it expires. Every consumer
  of `OAuthSessionStatus` (the response of `getStatus`, the
  `OAuthStartResult` from `start`) reads only these fields.

### Transient runtime primitives (cannot be serialised, must live in the host process)

- `abortController: AbortController` — a per-session cancellation
  handle used by `getStatus` (to mark an expired session) and by the
  `INITIATION_TIMEOUT_MS` guard (to abort the provider call if the
  provider never initiates). `AbortController` instances cannot be
  serialised: their `.signal` is an `EventTarget` with internal
  listeners, and their `.abort()` method is bound to the original
  instance.
- `submitManualCode?: (code: string) => void` — the Promise resolver
  captured when the SDK's `onManualCodeInput` / `onPrompt` callback
  fires. This is the bridge that lets the HTTP `submitCode` handler
  deliver the user's pasted code back into the in-flight
  `provider.login` Promise. Functions are not serialisable, and there
  is no portable way to reconstruct a Promise resolver in a different
  process.

The hybrid shape is the architectural reason the session cannot live
in Postgres or be naively rehydrated: the durable half wants durable
storage; the transient half wants per-pod runtime presence in exactly
one process at a time. The decision below reconciles the two halves
by routing them to two different systems that are each individually
fit for purpose.

## Decision

The durable half of the session is moved into **Redis** as the source
of truth; the transient half stays in a per-pod in-memory map keyed
by `sessionId`, indexed by the Redis durable record. Cross-pod
delivery of the manual code (the one piece of runtime data that must
cross pods) is routed through the existing
`RedisPubSubService` (`apps/api/src/redis/redis-pubsub.service.ts`).

### Durable store: Redis under the `oauth:session:` namespace

- One Redis key per session, namespaced `oauth:session:{sessionId}`,
  holds the JSON-serialised durable half of `LoginSession` (every
  field except `abortController` and `submitManualCode`).
- Writes use `SET key value EX 900` — 900 seconds (15 minutes) TTL,
  matching the existing `SESSION_TTL_MS = 15 * 60 * 1000` constant.
  Redis enforces TTL natively; the in-process `CLEANUP_INTERVAL_MS`
  setInterval is dropped (see Consequences).
- Reads on the `getStatus` hot path use `GET`; writes on status
  transitions (`pending → connected | failed | expired`) use `SET ...
  EX 900` to refresh the TTL. The `SET ... EX` form preserves the
  TTL semantics that today's `cleanupExpired()` was manually enforcing.
- `getStatus` resolves `pending + expiresAt < now` to `expired` and
  issues a `DEL` to drop the key, preserving the existing
  `NotFoundException` → `expired` status semantic.
- The transient half is held in `Map<string, { abortController,
  submitManualCode }>`, keyed by `sessionId`, exactly the same shape
  as today but with only the two runtime primitives — the durable
  fields are no longer mirrored in memory.

### Cross-pod code delivery: existing `RedisPubSubService`

The existing `RedisPubSubService` already exposes the surface we need
(`subscribeToRawChannel`, `unsubscribeFromRawChannel`, and
`publishToChannel`). The pub/sub channel namespace is
`oauth:session:{sessionId}:code`; messages are JSON-encoded
`{ code: string }` payloads published by the pod that owns the HTTP
`submitCode` request and received by whichever pod holds the live
transient half (the resolver, the `AbortController`).

- The owning pod (`onManualCodeInput` / `onPrompt` fired the resolver)
  subscribes on the channel for the lifetime of the in-flight
  `provider.login` Promise and unsubscribes once the resolver settles.
- `submitCode(sessionId, code)` publishes to the channel via
  `publishToChannel('oauth:session:{sessionId}:code', { code })`;
  the owning pod's subscriber wraps the message, calls the captured
  resolver with `code`, and unsubscribes.
- The channel is **purely** a code-delivery bus — it carries no
  durable state. A subscriber that misses a message because it was
  scaled down / restarted mid-login surfaces as `failed` on the
  durable side (see Consequences).

The decision is implemented incrementally across M2–M6 of work item
`53b39246-24df-4565-bd90-f468e0fd16cd`; this ADR records the
architectural shape, not the per-milestone migration matrix.

## Alternatives

### Option 1 — Reuse the existing `provider_oauth_sessions` table

Route the in-flight login state through the existing
`provider_oauth_sessions` table (the table that already backs the
post-callback PKCE storage path).

Rejected because the table is **wrong-shaped** for in-flight login
orchestration:

- The table's primary key is the PKCE callback state (`state`,
  `code_verifier`, `provider`, `redirect_uri`) — the artifacts that
  survive the OAuth callback round-trip. An in-flight login has no
  callback state yet; it has a `sessionId`, a `userCode`, a
  `verificationUri`, and a Promise. Forcing the in-flight shape into
  the PKCE callback columns would either lose information (no
  `userCode` / `verificationUri` slots) or require schema-level
  duplication (`device_code` vs. `authcode` rows with different
  column subsets).
- The table's lifecycle is keyed off the callback round-trip (insert
  on `start`, delete on `callback`); in-flight login state has a
  different lifecycle (insert on `start`, transition through `pending →
  connected | failed | expired`, delete on terminal status). Reusing
  the table means wedging two different lifecycles into one schema,
  which is exactly the silent-drift pattern that the per-concern
  service split (`ProviderOAuthSessionService` vs.
  `OAuthLoginService`) was designed to avoid.

### Option 2 — Postgres entity + new migration + cron cleanup

Introduce a dedicated Postgres table (e.g. `oauth_login_sessions`)
with a TypeORM entity, a new migration, and a periodic cron / interval
job that sweeps expired rows.

Rejected because:

1. **Higher polling latency.** `getStatus` is on the polling hot
   path (the device-code flow expects ≤ 5-second resolution for a
   healthy session); a Postgres round-trip per poll is one extra
   network hop per request, plus the TypeORM repository overhead,
   vs. a single Redis `GET`. Device-code polling is the canonical
   use case where every extra millisecond is visible to the user.
2. **Separate cron cleanup.** Redis TTL is enforced by the server;
   Postgres requires either (a) a background job or (b) lazy
   `expires_at < now()` filtering at read time. The background-job
   path is operational surface (a new worker, a new schedule, a new
   failure mode) for a problem Redis solves in `SET ... EX`. The
   lazy-filter path defeats the cleanup's purpose (rows pile up
   until vacuum).
3. **Schema churn.** The current refactor is constrained to
   `apps/api/src/oauth/` and `apps/api/src/redis/`; introducing a
   new entity + migration + repository ripples into `DatabaseModule`,
   migration ordering, and the seed-data validation pipeline —
   strictly larger blast radius than this refactor's scope.

### Option 3 — Sticky-session ingress

Pin every request for a given `sessionId` to the same pod via
ingress-level session affinity (cookie-based sticky routing).

Rejected because:

1. **Operationally fragile.** Sticky sessions require the
   load-balancer to honor a cookie / header for the duration of the
   login (up to 15 minutes), which interacts poorly with pod
   restarts (the sticky target disappears and subsequent requests
   404), with `kubectl rollout` (the old pod is replaced and the
   sticky's target is gone), with HPA scale-in (the sticky target
   is one of the pods being removed), and with multi-cluster
   routing.
2. **Doesn't solve pod restart.** Sticky sessions route requests to
   the same pod while the pod is alive, but they cannot resurrect
   state after a restart. The pod-restart bug above (item 2 in
   Context) is not addressed at all; it is only mitigated (and
   incompletely) on the horizontal-scale bug.
3. **Cost.** Every ingress change has rollout and observability
   implications across environments. The architectural move to a
   durable store is strictly cheaper long-term and resolves both
   bugs at once.

### Option 4 — BullMQ durable worker for true restart-and-resume

Move the in-flight `provider.login` orchestration into a BullMQ
worker with a durable job per session, so that a pod restart
rehydrates the worker and resumes the login from the last durable
checkpoint.

Deferred as a follow-up (see Follow-ups below) because:

1. **Rehydration is bigger than this refactor's scope.** The
   transient primitives (`AbortController`, `submitManualCode`
   resolver) cannot be naively rehydrated; they require a durable
   control-flow representation (a state machine, a journal of
   `onAuth` / `onDeviceCode` / `onManualCodeInput` events) that is
   strictly larger than moving the durable half to Redis.
2. **The Redis + pub/sub shape is a prerequisite, not a competitor.**
   The BullMQ worker still needs a Redis-backed durable store for the
   state it checkpoints into; landing the Redis-store shape first
   gives the worker migration a stable durable substrate to write
   into, rather than introducing both the storage and the worker
   rehydration in one milestone.
3. **Operative bugs ship sooner.** The horizontal-scale and
   pod-restart bugs above are production-blocking today; a BullMQ
   migration is a larger, multi-milestone refactor. Recording the
   BullMQ path as a follow-up (rather than blocking this ADR on it)
   unblocks the immediate correctness fix.

## Consequences

### Positive

- **Horizontal scale solved.** With Redis as the durable store,
  every pod sees the same `getStatus` answer; with pub/sub on the
  code channel, the `submitCode` request lands on any pod and the
  manual code reaches whichever pod holds the live transient half.
  The API can run with `replicas > 1` without cross-pod 404s.
- **Pod restart surfaces as `failed` with an explicit error, not a
  silent stuck session.** A pod restart orphans the transient half;
  the durable Redis record still exists. On the next `getStatus`,
  the polling pod observes `pending` with `expiresAt > now` (the
  Redis record is intact) but no transient half is reachable via
  pub/sub (the owning pod is gone); the implementation surfaces
  this as `status = 'failed'`, `error = 'OAuth session orphaned by
  pod restart'`, and proceeds to `DEL` the Redis key. Callers see
  an explicit failure rather than an indefinitely spinning poll
  loop on a dead pod.
- **Cleanup interval dropped.** Redis TTL enforces expiry
  natively; the in-process `setInterval(this.cleanupExpired, ...)`
  is removed, eliminating one timer per pod and the implicit
  ordering hazards it created with `AbortController.abort()`.
- **Single-source-of-truth for session state.** `getStatus` reads
  one Redis key; `submitCode` publishes to one Redis channel; no
  reconciliation between an in-process `Map` and an external store
  is required, because the durable half is in exactly one place.

### Negative / follow-ups

- **Pod-restart sessions still fail; they just fail loudly.** A
  true restart-and-resume requires durable rehydration of the
  `provider.login` Promise, which is the BullMQ worker follow-up
  below. The Redis shape records the failure mode but does not
  eliminate it.
- **Two-system coupling.** The durable half (Redis) and the
  transient half (per-pod `Map`) must agree on `sessionId` and on
  the lifecycle of the transient half's subscribe channel. A
  Redis-side record with no transient half on any pod is the
  orphan state surfaced as `failed` above; a transient half with no
  Redis-side record (e.g. publish before the initial `SET` commits)
  is a race that the implementation guards with a Redis-side
  existence check before subscribing.
- **Redis becomes a hard dependency for OAuth login.** Today
  `OAuthLoginService` only requires the `OAUTH_PROVIDER_RESOLVER`
  provider; after this refactor it also requires
  `REDIS_CLIENT` and `RedisPubSubService`. The dependency is
  acceptable because Redis is already required by the rest of the
  API (BullMQ, telemetry, etc.) and is in the standard docker
  compose stack, but the new module-boundary edge should be noted.

## Follow-up

- **BullMQ worker migration for true restart-and-resume.** Replace
  the per-pod `Map<string, { abortController, submitManualCode }>`
  transient half with a durable BullMQ worker that journals the
  SDK's `onAuth` / `onDeviceCode` / `onManualCodeInput` / `onPrompt`
  callbacks as events and replays them on pod restart. This is the
  follow-up deferred by Alternative 4 above; the Redis shape recorded
  in this ADR is the durable substrate the worker writes its
  checkpoints into. Owner TBD.
- **`session_taken_over_at` audit field.** Today there is no audit
  signal when a session's transient half is rebound (e.g. after a
  deliberate kill-and-republish of the code channel for testing,
  or after the orphan-recovery path promotes a `pending` session
  to a fresh transient half). Add a `session_taken_over_at:
  timestamp` field to the durable Redis record, populated by the
  orphan-recovery path and surfaced in `getStatus` for observability.
  Owner TBD.
- **Orphaned-session metric.** Surface a Prometheus counter
  (`nexus_oauth_login_orphaned_total`) incremented every time the
  durable Redis record exists with no reachable transient half and
  the orphan-recovery path transitions the session to `failed`.
  Today this failure mode is silent in dashboards (it shows up as
  `getStatus → failed`, indistinguishable from a provider-side
  error); a dedicated counter makes the pod-restart failure mode
  observable in production. The pattern follows the
  `BackendInstrumentation` helper extraction in
  `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md`
  — owner TBD, picked up alongside the BullMQ follow-up.

## Status

Status: Accepted. Owner: refactor-executor.

The decision recorded here is that the durable half of
`OAuthLoginService.sessions` is moved to Redis under the
`oauth:session:` namespace with a 900-second TTL, that the
transient half stays in a per-pod in-memory map, that cross-pod
delivery of the manual code is routed through the existing
`RedisPubSubService` (`publishToChannel` /
`subscribeToRawChannel` / `unsubscribeFromRawChannel`), and that the
in-process `CLEANUP_INTERVAL_MS` `setInterval` is dropped in favour
of Redis TTL. The implementation is delivered incrementally across
M2–M6 of work item `53b39246-24df-4565-bd90-f468e0fd16cd`; this
ADR is the architectural shape those milestones implement against.

## References

- `apps/api/src/oauth/oauth-login.service.ts` — the service
  refactored by this ADR; source of the `sessions` `Map`,
  `LoginSession` shape, `SESSION_TTL_MS`, and `CLEANUP_INTERVAL_MS`.
- `apps/api/src/redis/redis-pubsub.service.ts` — the pub/sub
  service whose `publishToChannel` / `subscribeToRawChannel` /
  `unsubscribeFromRawChannel` surface the cross-pod code-delivery
  channel is built on.
- `docs/architecture/decisions/ADR-backend-instrumentation-helper-extraction.md` —
  the pattern for Prometheus-counter follow-ups; the
  `nexus_oauth_login_orphaned_total` follow-up above reuses the
  `recordBackend*` mirror shape documented there.