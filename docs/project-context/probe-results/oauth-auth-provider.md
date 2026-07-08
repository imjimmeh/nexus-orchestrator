---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: oauth-auth-provider
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/api/src/oauth/anthropic-oauth.provider.ts
  - apps/api/src/oauth/anthropic-oauth.provider.spec.ts
  - apps/api/src/oauth/pi-ai-oauth-provider.resolver.ts
  - apps/api/src/oauth/pi-ai-oauth-provider.resolver.spec.ts
  - apps/api/src/oauth/oauth.module.ts
source_paths:
  - apps/api/src/oauth/anthropic-oauth.provider.ts
  - apps/api/src/oauth/anthropic-oauth.provider.spec.ts
  - apps/api/src/oauth/pi-ai-oauth-provider.resolver.ts
  - apps/api/src/oauth/pi-ai-oauth-provider.resolver.spec.ts
  - apps/api/src/oauth/oauth.module.ts
updated_at: 2026-06-20T16:07:39Z
---

# Probe Result: OAuth Auth Provider (work item WI-2026-047)

## Narrative Summary

The `oauth-auth-provider` scope is **fully implemented**. The five source files
under `apps/api/src/oauth/` are real, behavior-bearing implementations — not
stubs — and together they constitute a complete, server-less Anthropic
authorization-code + PKCE OAuth flow plus a NestJS-side resolver that
dispatches between the local provider and the upstream `@earendil-works/pi-ai/oauth`
SDK registry for every other preset. Per-file contribution:

- **`apps/api/src/oauth/anthropic-oauth.provider.ts`** (297 lines) is a
  concrete `OAuthProviderInterface` exported as `anthropicOAuthProvider`. It
  drives the authorization-code + PKCE flow **without** opening a local
  loopback callback server (the upstream SDK provider binds 127.0.0.1:53692,
  leaks the port across abandoned attempts, and is unreachable on a deployed
  API host where the browser runs on a different machine). The local
  implementation relies solely on the manual paste path
  (`onManualCodeInput`) and parses either a raw code or a full redirect URL
  by splitting on `#` (`STATE_DELIMITER`) for the `state` parameter. It
  exposes PKCE generation (`createHash`, 32-byte `randomBytes` verifier),
  authorize-URL emission with the registered Claude Code redirect, a
  `login()` flow with manual-code / URL / `onPrompt` fallback, an
  `AbortSignal`-aware abort path, the `refresh_token` grant, a `getApiKey()`
  accessor, and a `postToken()` helper with a 30s timeout, abort
  propagation, and JSON-shape validation. Constants mirror the SDK's
  Claude Code preset (`CLIENT_ID`, `AUTHORIZE_URL`, `TOKEN_URL`,
  `REDIRECT_URI`, `SCOPES`) and a 5-minute token-expiry skew is applied
  (`TOKEN_EXPIRY_SKEW_MS`).
- **`apps/api/src/oauth/anthropic-oauth.provider.spec.ts`** (236 lines,
  11 `it()` blocks under a single `describe('anthropicOAuthProvider')`)
  exercises every behavior of the provider: no loopback server is opened;
  the authorization URL includes PKCE and the registered redirect; a
  pasted `code#state` pair is exchanged for credentials; a pasted full
  redirect URL is also accepted; the flow falls back to `onPrompt` when
  `onManualCodeInput` is absent; state mismatch is rejected; missing
  authorization code is rejected; the token-exchange failure path is
  rejected; the login aborts when the signal is triggered; the
  `refresh_token` grant round-trips credentials; and `getApiKey()`
  returns the access token.
- **`apps/api/src/oauth/pi-ai-oauth-provider.resolver.ts`** (32 lines) is
  an `@Injectable()` NestJS service implementing `OAuthProviderResolver`.
  The `resolve(piProviderId)` method short-circuits for the `anthropic`
  preset by returning the local server-less `anthropicOAuthProvider` and
  dynamically imports `@earendil-works/pi-ai/oauth` (an ESM-only module)
  on first use, caching the `getOAuthProvider` lookup thereafter. The
  cache-once dynamic-import pattern avoids the static ESM-import
  incompatibility while still routing every non-anthropic preset through
  the SDK registry.
- **`apps/api/src/oauth/pi-ai-oauth-provider.resolver.spec.ts`** (39 lines,
  2 `it()` blocks) covers the resolver's two key paths: returning the
  local server-less provider when the requested preset is `anthropic`,
  and dynamically loading the SDK + returning its provider for any
  other preset id.
- **`apps/api/src/oauth/oauth.module.ts`** (18 lines) is the NestJS
  `@Module` declaration. It registers `OAuthLoginService` as a provider
  and binds `OAUTH_PROVIDER_RESOLVER` to `PiAiOAuthProviderResolver` via
  `useClass`. It exports both `OAuthLoginService` and
  `OAUTH_PROVIDER_RESOLVER` so the engine-only surface stays self-contained
  — no storage concern leaks into the engine; callers (provider page,
  harness credential bindings) supply their own credential sink.

### Test-harness note

The probe attempted to run the unit-test suite via
`npm run test --workspace=apps/api -- anthropic-oauth pi-ai-oauth-provider`.
The Vitest worker exited with `Cannot find package 'dotenv' imported from
/workspace/apps/api/test/vitest.setup.ts`. This is an **environmental**
issue (the test harness dependency `dotenv` is missing from
`apps/api/package.json` or the workspace root `node_modules`) and is
unrelated to the OAuth source code under probe. The five source files
ship as production code; the spec files are conventional Vitest suites
that mirror the patterns used elsewhere in the API codebase. The test
harness itself is out of scope for this probe and should be addressed in
a separate follow-up.

### Module wiring

```
OAuthModule
  ├─ OAuthLoginService                              (provider + export)
  └─ OAUTH_PROVIDER_RESOLVER → PiAiOAuthProviderResolver (provider + export)
        └─ anthropicOAuthProvider                   (local server-less)
        └─ @earendil-works/pi-ai/oauth.getOAuthProvider  (dynamic SDK)
```

## Capability Updates

- **Anthropic OAuth authorization-code + PKCE flow without a loopback
  callback server** — `anthropicOAuthProvider` (`anthropic-oauth.provider.ts`)
  drives the full flow via manual paste / URL / `onPrompt` paths, with
  PKCE generated locally, the registered Claude Code client + redirect,
  and an abort signal that is honored end-to-end.
- **Token refresh via the `refresh_token` grant** — `anthropicOAuthProvider`
  exposes a refresh path that round-trips new credentials and preserves
  the 5-minute skew against expiry.
- **`postToken` helper with timeout, abort, and JSON validation** — the
  token-exchange helper enforces a 30-second timeout, propagates the
  abort signal, and rejects non-JSON / malformed responses.
- **`getApiKey` access-token accessor** — `anthropicOAuthProvider.getApiKey()`
  returns the access token from the stored `OAuthCredentials`.
- **Local Anthropic preset resolver with dynamic SDK fallback** —
  `PiAiOAuthProviderResolver` returns the local server-less provider for
  the `anthropic` preset and dynamically loads
  `@earendil-works/pi-ai/oauth.getOAuthProvider` for any other preset,
  caching the import after first use.
- **NestJS module wiring with injection-token indirection** —
  `OAuthModule` provides `OAuthLoginService` directly and exposes the
  resolver via the `OAUTH_PROVIDER_RESOLVER` injection token (interface
  boundary), letting consumers depend on the abstraction rather than the
  concrete class.
- **Engine-only module boundary** — `OAuthModule` is self-contained
  (no storage imports); callers supply their own credential sink.

## Health Findings

- **Code quality is high.** All five files are typed end-to-end against
  `OAuthProviderInterface` / `OAuthCredentials` / `OAuthLoginCallbacks`
  from `@earendil-works/pi-ai/oauth` and against the local
  `OAuthProviderResolver` interface from `oauth-login.types.ts`. No
  `any` leakage, no `eslint-disable` / `@ts-ignore` / `@ts-nocheck`
  suppression, no stub bodies or hard-coded literals in the source.
- **Test coverage is meaningful for both behaviors under probe.**
  - `anthropic-oauth.provider.spec.ts`: 1 `describe`, 11 `it`. Covers
    loopback avoidance, PKCE emission, manual-code parsing, full-URL
    parsing, `onPrompt` fallback, state-mismatch rejection,
    no-code rejection, exchange-failure rejection, abort propagation,
    refresh round-trip, and `getApiKey` accessor.
  - `pi-ai-oauth-provider.resolver.spec.ts`: 2 `it`. Covers the local
    anthropic short-circuit and the dynamic SDK fallback.
- **Defensive design choices.** The provider hard-codes the
  pre-registered Claude Code `CLIENT_ID` / `REDIRECT_URI` and the
  public PKCE constants from the SDK preset rather than reading them
  from configuration; this matches the SDK's authoritative source and
  avoids drift. The resolver caches the dynamic SDK import once and
  never re-imports.
- **No stubs, no TODOs, no HACK markers in the assigned files.**

## Open Questions

- **Vitest harness `dotenv` dependency missing.** The unit-test run
  for this scope failed at the harness level
  (`apps/api/test/vitest.setup.ts` imports `dotenv` but the package
  is not installed in `apps/api`'s `node_modules`). This is a test
  infrastructure issue, not a source-code defect; the OAuth source
  itself is intact and behavior-bearing. Recommended follow-up:
  add `dotenv` to `apps/api/package.json` `devDependencies` (or move
  the setup import behind a conditional `try/catch`) and re-run
  `npm run test --workspace=apps/api -- anthropic-oauth pi-ai-oauth-provider`
  to confirm the existing 11+2 spec scenarios pass.
- **Resolver caching semantics.** `PiAiOAuthProviderResolver` caches the
  dynamic SDK import on first use and never invalidates the cache.
  This is correct for a long-lived NestJS provider but means a
  hypothetical SDK reload would require a process restart. Out of scope
  for this probe but worth flagging if hot-reload of the SDK is a
  desired capability.
- **Module wiring does not declare the consumer side.** `OAuthModule`
  exports `OAuthLoginService` and `OAUTH_PROVIDER_RESOLVER`, but the
  consumers of this module (provider page, harness credential
  bindings) are not enumerated in this scope. Whether the consumers
  are wired correctly is out of scope here.
