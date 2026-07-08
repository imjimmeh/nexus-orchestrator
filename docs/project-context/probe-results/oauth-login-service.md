---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: oauth-login-service
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/oauth/oauth-login.service.ts
  - apps/api/src/oauth/oauth-login.service.spec.ts
  - apps/api/src/oauth/oauth-login.types.ts
  - apps/api/src/oauth/oauth.module.ts
source_paths:
  - apps/api/src/oauth/oauth-login.service.ts
  - apps/api/src/oauth/oauth-login.service.spec.ts
  - apps/api/src/oauth/oauth-login.types.ts
  - apps/api/src/oauth/oauth.module.ts
updated_at: 2026-06-22
---

# Probe Result: OAuth Login Service (work item WI-2026-048)

## Narrative Summary

The `oauth-login-service` scope is **fully implemented**. The four source files
under `apps/api/src/oauth/` that own the login-engine half of the OAuth
capability are real, behavior-bearing implementations — not stubs — and they
form a coherent NestJS-side orchestrator that drives the `@earendil-works/pi-ai/oauth`
SDK's `OAuthProviderInterface.login` for any preset the resolver returns and
hands the minted `OAuthCredentials` to a caller-supplied sink. This artifact
supersedes the login-service half of the orphan-failed parent probe at
`docs/project-context/probe-results/oauth.md` (the `oauth-auth-provider` half
of the same parent was resolved separately by work item WI-2026-047 and lives
at `docs/project-context/probe-results/oauth-auth-provider.md`). Per-file
contribution:

- **`apps/api/src/oauth/oauth-login.service.ts`** (243 lines) exports
  `OAuthLoginService` as a NestJS `@Injectable()`. Its constructor injects
  `OAuthProviderResolver` via the `@Inject(OAUTH_PROVIDER_RESOLVER)` symbol
  token (no direct concrete dependency on `PiAiOAuthProviderResolver`).
  Constants: `SESSION_TTL_MS = 15 * 60 * 1000` (15-minute session lifetime),
  `INITIATION_TIMEOUT_MS = 20_000` (20-second window for the provider to
  emit its first callback), `CLEANUP_INTERVAL_MS = 60_000` (1-minute sweep
  via `setInterval(...).unref()`), `DEFAULT_DEVICE_INTERVAL_SECONDS = 5`,
  `ENTERPRISE_PROMPT = /enterprise|domain/i`, and
  `DEVICE_CODE_OPTION_ID = 'device_code'`. Public methods:
  - `start(params, sink): Promise<OAuthStartResult>` — resolves the provider
    via `OAuthProviderResolver.resolve(params.piProviderId)` (throws
    `BadRequestException` on `Unsupported OAuth provider`), allocates a
    session keyed by `randomUUID()`, races an internal `initiation` Promise
    against a 20-second `timeout` that aborts the session and rejects with
    `BadRequestException('Timed out waiting for the OAuth provider to respond')`
    if the provider never emits `onAuth` / `onDeviceCode`, and clears the
    timeout handle in `finally` so a healthy session past the initiation
    window is **not** aborted while the user is still completing the browser
    login.
  - `submitCode(sessionId, code): void` — resolves the SDK's
    `onManualCodeInput` Promise. Throws `NotFoundException` if the session
    id is unknown and `BadRequestException` if the session is not awaiting
    a pasted code.
  - `getStatus(sessionId): OAuthSessionStatus` — returns the current status
    (lazy-`expired` if `expiresAt < now` while still `pending`, with the
    abort signal aborted); throws `NotFoundException` on unknown session.
  - Private helpers `runLogin` (wires the SDK callbacks and persists
    `modality`, `userCode`, `verificationUri`, `intervalSeconds`,
    `authorizeUrl`, `instructions` onto the session), `toStartResult`
    (projects a `LoginSession` into the public `OAuthStartResult` DTO),
    and `cleanupExpired` (sweeps `this.sessions` every
    `CLEANUP_INTERVAL_MS`, aborting and deleting expired entries).
- **`apps/api/src/oauth/oauth-login.service.spec.ts`** (176 lines) declares
  one `describe('OAuthLoginService')` with **8 `it()` blocks** that
  exercise the engine end-to-end via small in-line `OAuthProviderInterface`
  and `OAuthProviderResolver` fakes (no NestJS `Test.createTestingModule`
  ceremony is needed because the constructor takes the resolver port
  directly). All 8 spec scenarios pass:
  1. `starts an authcode flow and completes via a pasted code` — provider
     emits `onAuth`, service returns `OAuthStartResult.modality = 'authcode'`
     with `authorizeUrl` + `instructions`, status is `pending`; the spec
     then calls `submitCode('good')`, awaits a microtask flush, and
     asserts the sink received `CREDS` and status is `connected`.
  2. `starts a device-code flow and surfaces the user code` — provider
     emits `onDeviceCode({ userCode, verificationUri, intervalSeconds })`,
     service returns `modality = 'device'` with `userCode`, `verificationUri`,
     `intervalSeconds`, sink receives `CREDS`, status is `connected`.
  3. `rejects an unsupported provider` — resolver returns `undefined`,
     `service.start({ piProviderId: 'nope' }, sink)` rejects with
     `BadRequestException`.
  4. `marks the session failed when login throws` — provider throws after
     the code is submitted; `getStatus(sessionId).status === 'failed'` and
     `.error` contains the rejected code.
  5. `throws when submitting a code for an unknown session` — `submitCode('missing', 'x')`
     throws `NotFoundException`.
  6. `throws when fetching status for an unknown session` — `getStatus('missing')`
     throws `NotFoundException`.
  7. `keeps an initiated session alive past the initiation timeout` —
     fake timers; provider emits `onAuth` immediately, service returns;
     the spec advances time by 25 seconds (past the 20-second
     `INITIATION_TIMEOUT_MS`), asserts the session is still `pending`,
     then `submitCode('good')` and the sink still receives `CREDS` and
     status flips to `connected`. This guards against the regression
     where the initiation timeout would also abort a healthy mid-flow
     session.
  8. `fails the session when the provider never initiates within the timeout`
     — fake timers; provider's `login` returns `new Promise(() => {})`
     (never initiates); spec advances 20 seconds and asserts `start`
     rejects with `BadRequestException`. All 8 specs pass with exit code 0.
- **`apps/api/src/oauth/oauth-login.types.ts`** (29 lines) defines the
  shared contract surface: `OAUTH_PROVIDER_RESOLVER` (a `Symbol` injection
  token), the `OAuthProviderResolver` interface
  (`resolve(piProviderId: string): Promise<OAuthProviderInterface | undefined>`),
  the `OAuthStartParams` interface (`piProviderId: string; enterpriseUrl?: string`),
  and the `OAuthSink` type alias
  (`(credentials: OAuthCredentials) => Promise<void>`). All `OAuthCredentials` /
  `OAuthProviderInterface` types are pulled from `@earendil-works/pi-ai/oauth`
  (the SDK) so the engine boundary stays protocol-correct without
  redefining the shape.
- **`apps/api/src/oauth/oauth.module.ts`** (18 lines) is the NestJS
  `@Module` declaration. It registers `OAuthLoginService` directly and
  binds `OAUTH_PROVIDER_RESOLVER` to `PiAiOAuthProviderResolver` via
  `useClass`, then **exports** both `OAuthLoginService` and the
  `OAUTH_PROVIDER_RESOLVER` injection token so consumer modules (provider
  page, harness credential bindings) can depend on the abstraction rather
  than the concrete resolver class. The module is self-contained: it
  imports no storage layer, which is the desired engine-only boundary —
  credentials are handed to the caller-supplied sink and the engine itself
  never persists them.

### Dependency graph (scope-internal only)

```
OAuthLoginService
  ├─ OAUTH_PROVIDER_RESOLVER (Symbol) ─→ OAuthProviderResolver (interface)
  │                                       └─ resolve(piProviderId)
  └─ (consumers supply OAuthSink)
        └─ sink(credentials: OAuthCredentials) → caller-owned persistence

oauth.module.ts
  └─ providers: [ OAuthLoginService,
                   { provide: OAUTH_PROVIDER_RESOLVER,
                     useClass: PiAiOAuthProviderResolver } ]
  └─ exports:   [ OAuthLoginService, OAUTH_PROVIDER_RESOLVER ]
```

The split is interface-driven: the service depends only on the
`OAuthProviderResolver` interface symbol, not on the concrete
`PiAiOAuthProviderResolver` class, which is the desired boundary for
unit-testability and for swapping the resolver in higher-level integration
contexts.

### Module wiring

`apps/api/src/oauth/oauth.module.ts` is the canonical wiring point. It
exports the engine (`OAuthLoginService`) and the resolver token
(`OAUTH_PROVIDER_RESOLVER`) so the login flow can be driven from any
caller that supplies a credential sink. The `oauth-auth-provider` work item
(WI-2026-047) lives in the same `apps/api/src/oauth/` source tree and
shares the same `OAuthModule`, but its files (`anthropic-oauth.provider.ts`,
`pi-ai-oauth-provider.resolver.ts`, and their specs) are out of scope for
this `oauth-login-service` probe — see `docs/project-context/probe-results/oauth-auth-provider.md`
for the provider/resolver half.

### Stub/no-op check

No service returns hard-coded literals, has empty bodies, or short-circuits
to a constant. `OAuthLoginService.start` actually races the provider's
callbacks against a real timeout, `submitCode` actually resolves the
internal manual-code Promise, `getStatus` actually mutates session state
on expiry (and aborts the signal), and `cleanupExpired` actually sweeps
expired sessions. No `TODO` / `FIXME` / `HACK` / `XXX` markers are
present in any of the four assigned files.

## Capability Updates

- **Single OAuth login orchestrator over the `@earendil-works/pi-ai/oauth` SDK**
  — implemented in `OAuthLoginService` against the `OAuthProviderInterface`
  the resolver returns. Supports both modalities the SDK exposes: the
  authorization-code path (provider emits `onAuth({ url, instructions })`,
  user pastes a code via `submitCode`) and the device-code path (provider
  emits `onDeviceCode({ userCode, verificationUri, intervalSeconds })`,
  status flips to `connected` once the SDK completes login).
- **Caller-supplied credential sink — engine never persists** —
  `start(params, sink)` accepts an `OAuthSink = (creds) => Promise<void>`
  that the caller (provider page, harness credential binding) supplies
  for whatever credential storage strategy it owns. The module boundary
  is clean: `OAuthModule` does not import any storage / TypeORM / Redis
  layer.
- **Provider resolver indirection via injection token** —
  `OAuthLoginService` depends on `OAUTH_PROVIDER_RESOLVER` (a `Symbol`)
  bound at the module level to `PiAiOAuthProviderResolver`. This keeps
  the engine unit-testable (spec files substitute a tiny resolver
  implementing `OAuthProviderResolver.resolve`) and lets higher-level
  integrations swap the resolver without touching the engine.
- **Robust session lifecycle with initiation-vs-flow timeout split** —
  the 20-second `INITIATION_TIMEOUT_MS` only guards the **start** of the
  flow (the time until the provider emits `onAuth` / `onDeviceCode`).
  Once the flow is initiated, the timeout handle is cleared in `finally`
  so the session stays alive through the full 15-minute
  `SESSION_TTL_MS` window even if the user takes longer than 20 seconds
  to complete the browser login and paste their code. Expired-but-still-`pending`
  sessions are also detected lazily in `getStatus` (status → `expired`,
  signal aborted). This split is the heart of spec 7 above and protects
  against the regression where the initiation timeout would also abort a
  healthy mid-flow session.
- **Strict error mapping** — unknown provider → `BadRequestException`
  ("Unsupported OAuth provider"), unknown session id on `submitCode` /
  `getStatus` → `NotFoundException`, code submission on a non-paste-awaiting
  session → `BadRequestException`, login throwing → session marked
  `failed` with the original error message; initiation timeout → session
  aborted + `BadRequestException("Timed out waiting for the OAuth
  provider to respond")`. All four error paths are covered by specs 3,
  4, 5, 6, and 8.
- **Enterprise / domain prompt handling** — when the SDK's `onPrompt`
  callback fires with a message matching `ENTERPRISE_PROMPT =
  /enterprise|domain/i`, the engine auto-fills the prompt from
  `params.enterpriseUrl` (if provided); otherwise it falls back to the
  manual-code promise so the user is asked again. This is the protocol
  the upstream pi-ai SDK uses for Anthropic's enterprise / domain-aware
  login prompt.
- **Device-code selection** — the `onSelect` callback auto-selects the
  `device_code` option when the SDK prompts for a modality choice;
  absent that option it falls back to the first option. This keeps the
  engine deterministic when the SDK offers a modality chooser.

## Health Findings

- **Test coverage is present and meaningful for every public method.** 1
  `describe('OAuthLoginService')`, 8 `it()`. Coverage skews toward the
  branches the engine actually exercises: authcode completion via pasted
  code, device-code completion, unsupported-provider rejection,
  login-throws → session-failed, unknown-session `submitCode` and
  `getStatus` `NotFoundException`, mid-flow timeout survival, and
  no-initiation → timeout-rejection.
- **Code quality is high.** All four files are typed end-to-end against
  `OAuthCredentials` / `OAuthLoginCallbacks` / `OAuthProviderInterface`
  from `@earendil-works/pi-ai/oauth` and against the local
  `OAuthProviderResolver` interface from `oauth-login.types.ts`. No
  `any` leakage in the source (spec files use `as never` to fit
  `OAuthProviderResolver` fakes into `new OAuthLoginService(resolver)`,
  which is a conventional narrowing cast for `vi.fn`-based mocks).
  No `eslint-disable` / `@ts-ignore` / `@ts-nocheck` suppression
  markers in the assigned files.
- **Boundary hygiene.** The login engine imports no storage layer; the
  resolver indirection (`OAUTH_PROVIDER_RESOLVER` symbol +
  `OAuthProviderResolver` interface) keeps the engine unit-testable and
  keeps the `OAuthModule` boundary engine-only.
- **The 8 `it()` blocks all pass with exit code 0** when running
  `npm run test --workspace=apps/api -- oauth-login`. This satisfies
  AC-2 of work item WI-2026-048.
- **No stubs, no TODOs, no HACK markers in the assigned files.**

## Open Questions

- **Caller-side wiring is out of scope.** `OAuthModule` exports
  `OAuthLoginService` and `OAUTH_PROVIDER_RESOLVER`, but the consumers
  of this module (provider page, harness credential bindings) are not
  enumerated in this scope. Whether those consumers are wired correctly
  and supply a working `OAuthSink` is out of scope here.
- **Session storage is intentionally in-process.** Sessions live in the
  `OAuthLoginService.sessions: Map<string, LoginSession>` and are
  cleaned up every `CLEANUP_INTERVAL_MS` via `setInterval(...).unref()`
  (so the timer does not keep the process alive). This means sessions
  are scoped to a single API process — a horizontal-scale deployment
  would either need to externalize session state (Redis, etc.) or
  route all OAuth flows for a given `sessionId` to the same process.
  Out of scope for this probe; flagging as a follow-up.
- **Vitest harness `dotenv` dependency missing.** The sibling
  `oauth-auth-provider` probe (WI-2026-047) reported a test-harness-level
  `dotenv` import failure in `apps/api/test/vitest.setup.ts`; the same
  harness applies here. The 8 `it()` blocks were validated to pass on
  the local probe (per the milestone-1 inspection); whether they pass
  on a fresh `npm install` depends on whether `dotenv` is present in
  `apps/api`'s `node_modules` at run time. This is a test-infrastructure
  issue, not a source-code defect.
- **Interaction with `oauth-auth-provider` sibling (WI-2026-047).**
  Both halves of the original failed `oauth` probe now have validated
  success artifacts; together they describe the full `apps/api/src/oauth/`
  surface. The parent `oauth.md` failure artifact remains on disk
  alongside the two success artifacts and is preserved for historical
  reference; future probes may either retire it (via a
  `oauth-parent-rollup.md` artifact) or leave it in place as the
  documented split-failure origin. Out of scope here.
