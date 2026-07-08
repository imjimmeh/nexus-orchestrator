---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: harness-config
outcome: success
inferred_status: implemented
confidence_score: 0.9
evidence_refs:
  - apps/api/src/harness/harness.module.ts
  - apps/api/src/harness/harness-config.controller.ts
  - apps/api/src/harness/harness-config.service.ts
  - apps/api/src/harness/harness-config.types.ts
  - apps/api/src/harness/harness-provider-registry.service.ts
  - apps/api/src/harness/harness-provider-registry.types.ts
  - apps/api/src/harness/harness-credential-resolver.service.ts
  - apps/api/src/harness/harness-credential.controller.ts
  - apps/api/src/harness/harness-credential-binding.repository.ts
  - apps/api/src/harness/harness-credential-binding.types.ts
  - apps/api/src/harness/harness-oauth-link.service.ts
  - apps/api/src/harness/harness-oauth-link.service.types.ts
  - apps/api/src/harness/harness-oauth.controller.ts
  - apps/api/src/harness/harness-scoped-defaults.controller.ts
  - apps/api/src/harness/scoped-ai-default-resolver.ts
  - apps/api/src/harness/scoped-ai-default.service.ts
  - apps/api/src/harness/scoped-ai-default.repository.ts
  - apps/api/src/harness/scoped-ai-default.types.ts
  - apps/api/src/harness/harness-selection.ts
  - apps/api/src/harness/harness-runtime-selection.ts
  - apps/api/src/harness/harness-runtime-selection.types.ts
  - apps/api/src/harness/harness-policy.ts
  - apps/api/src/harness/harness-diagnostics.ts
  - apps/api/src/harness/harness-validate.types.ts
  - apps/api/src/harness/harness-http-client.port.ts
  - apps/api/src/harness/harness-http-client.types.ts
  - apps/api/src/harness/fetch-harness-http-client.ts
  - apps/api/src/harness/harness-definition.repository.ts
  - apps/api/src/harness/entities/harness-definition.entity.ts
  - apps/api/src/harness/entities/harness-credential-binding.entity.ts
  - apps/api/src/harness/entities/scoped-ai-default.entity.ts
  - apps/api/src/harness/entities/index.ts
source_paths:
  - apps/api/src/harness/
updated_at: 2026-06-15T17:28:44Z
---

# Probe Result: Harness Configuration and Providers (API)

## Narrative Summary

`apps/api/src/harness/` is a complete, well-organized Nest module that owns the
server-side surface for harness configuration, credential binding, OAuth link,
runtime selection, and per-scope AI defaults. It registers four controllers,
~ten providers, and three TypeORM entities, and is wired into
`AuthorizationModule`, `ScopeModule`, and `OAuthModule` so harness definitions,
credential bindings, and scoped defaults can be governed and scoped using the
existing auth/scope plumbing.

**Key pieces**

- `HarnessModule` — the module of record, exporting `HarnessProviderRegistryService`,
  `HarnessConfigService`, `HarnessCredentialResolverService`, `ScopedAiDefaultService`,
  and `ScopedAiDefaultResolver` for downstream consumers (e.g., workflow steps,
  runner selection, and the AI configuration service).
- `HarnessConfigController` (mounted at `/harness`) exposes list/detail/create/
  update/remove/`POST /:harnessId/validate` for harness definitions. Built-in
  harnesses are read-only; mutation is restricted to `custom:*` IDs.
- `HarnessProviderRegistryService` seeds two built-in providers — `pi` and
  `claude-code` — with capabilities sourced from `@nexus/core`
  (`PI_CAPABILITIES`, `CLAUDE_CODE_CAPABILITIES`) and Docker image refs read
  from `HARNESS_IMAGE_PI` / `HARNESS_IMAGE_CLAUDE_CODE` env vars with sensible
  defaults. Custom definitions are loaded from the DB on `onModuleInit`.
- `HarnessCredentialResolverService` resolves a primary credential for a harness
  by walking the scope chain most-specific → ancestors → platform (`null`), and
  returns the remaining (non-primary) bindings as a `key → ResolvedHarnessCredential`
  map. It depends on `HarnessCredentialBindingRepository`, `ScopeService`, and
  `SecretCrudService`, and protects against empty `api_key` placeholders.
- `HarnessCredentialController` and `HarnessOAuthController` expose
  `GET /:harnessId/credentials`, `PUT/DELETE /:harnessId/credentials/:key`,
  and the OAuth start/submit-code/session-status endpoints, all guarded by
  `JwtAuthGuard` + `PermissionsGuard` with `settings:read`/`settings:manage`.
- `HarnessOAuthLinkService` bridges the requirement-declared `oauthProviderId`
  to the unified `OAuthLoginService`, mints a secret, and upserts a scoped
  binding on success.
- `HarnessScopedDefaultsController`, `ScopedAiDefaultService`, and
  `ScopedAiDefaultResolver` model per-scope AI defaults (harness/model/provider)
  with field-level precedence: the most-specific row wins per field, then
  ancestors, then the platform row (`scopeNodeId = NULL`). This is the layer
  that the harness-runtime-selection step override / project default reads from.
- `harness-selection.ts` defines pure precedence + validation
  (`resolveHarnessId`, `requiredCapabilitiesForStep`, `validateOrFallback`,
  `validateProviderCompatibility`) and `harness-runtime-selection.ts` wraps
  that into the runtime `resolveRunnerHarness` resolver, including
  re-resolution of the runner provider config when an incompatible provider
  is detected and best-effort ledger event emission via
  `harness-diagnostics.ts`.
- `harness-policy.ts` exports `assertMayUseHarness` for the
  `policyScope.{projects,roles}` ACL.
- HTTP probes (`POST /:harnessId/validate` for `external` transport) go through
  the `HARNESS_HTTP_CLIENT` injection port, with a default `FetchHarnessHttpClient`
  implementation that wraps global `fetch` with an `AbortController`-based
  timeout and returns `ok:false, status:0` on any error.

## Capability Updates

- **Custom harness definitions are CRUD-able, kernel- or external-transport.**
  `HarnessConfigService.create` enforces the `custom:` prefix on new IDs and
  sets defaults (`source:'custom'`, `enabled:true`, `defaultEnv={}`,
  `policyScope={}`); `update`/`remove` reject edits to builtins. Validation
  probes external harnesses via `{baseUrl}/health` and reports
  `capabilities` if the response carries them, or `reachable:false` on
  any failure (timeout, non-2xx, missing URL).
- **Built-in harness registry is env-overridable.** `pi` and `claude-code`
  are seeded with `HARNESS_IMAGE_PI` / `HARNESS_IMAGE_CLAUDE_CODE` env vars
  (defaulting to `nexus/harness-pi:latest` and
  `nexus/harness-claude-code:latest`). `claude-code` adds
  `DISABLE_AUTOUPDATER=1` to `defaultEnv`. The registry enforces
  `enabled: true` for the `list()` view.
- **Credential resolution is scope-aware.** `HarnessCredentialResolverService`
  builds a chain `[mostSpecific, ...ancestorsRootFirst, null]` and asks the
  binding repo for the first match. It distinguishes "empty api_key" from
  "no binding" and only throws when a required primary is unbound AND the
  caller-supplied `providerAuth` is the empty placeholder. OAuth credentials
  are never treated as "empty" here.
- **OAuth linkage is unified.** `HarnessOAuthLinkService.start` selects the
  first `oauth_authcode`/`oauth_device` auth type declared by the
  requirement, delegates the dance to `OAuthLoginService`, mints a secret
  via `SecretCrudService.create` with a deterministic
  `harness:<id>:<key>:<uuid>` name, and upserts a binding with the resolved
  `authType` and `secretId`.
- **Per-scope AI defaults are field-level precedented.**
  `ScopedAiDefaultResolver` walks ancestors most-specific-first, and for
  each of `harnessId`, `modelName`, `providerName` returns the first
  non-null/non-empty value. Platform (`scopeNodeId = NULL`) acts as the
  final fallback. The single-platform-row invariant is enforced
  application-side in `ScopedAiDefaultRepository.upsertForScope` because
  Postgres treats `NULL` as distinct in a UNIQUE index.
- **Runtime selection validates both capability and provider compatibility.**
  `resolveRunnerHarness` applies step override → project default → platform
  default, then asks the registry's `validateForStep` to fall back when
  required capabilities are missing. When the registry exposes
  `resolve(harnessId)`, it additionally calls `validateProviderCompatibility`
  and — on incompatibility — re-resolves the runner provider config via
  `AiConfigurationService.resolveRunnerProviderConfig` and emits
  `harness.selection.fallback` to the ledger.
- **Diagnostics: `harness-diagnostics.ts`** emits
  `harness.selection.resolved` and (when applicable)
  `harness.selection.fallback` ledger events.
- **Policy guard: `assertMayUseHarness(caller, def)`** allows when
  `policyScope` is empty, or when both `projects` and `roles` admit the
  caller. Throws `ForbiddenException` otherwise. Not yet wired into the
  harness controller path (see Open Questions).

## Health Findings

- **Test coverage is strong and almost universal.** Every service, controller,
  repository, and entity has a corresponding `*.spec.ts` (15 spec files,
  ~1500 LOC of test code against ~2800 LOC of source). The selection,
  resolution, registry, and validate behaviors are exercised in detail,
  including scope-chain ordering (`leaf → parent → root → null`),
  field-level precedence for `ScopedAiDefaultResolver`, capability/provider
  fallback paths, and the HTTP client fetch mapping.
- **Two source files lack spec coverage:**
  - `harness-oauth-link.service.ts` — no spec; the OAuth link integration
    with `OAuthLoginService` and secret creation is uncovered. This is
    a real gap given that the binding is persisted on a best-effort
    callback.
  - `harness-oauth.controller.ts` — no spec; the controller layer that
    ties the link service to the HTTP surface is uncovered.
  These are both reachable from the public API and should be considered
  for the next round of test additions.
- **The 11 type/port files** (`*.types.ts`, `harness-http-client.port.ts`,
  `entities/index.ts`) intentionally have no specs.
- **Code quality observations:**
  - Repository helper `findForScopeChain` is implemented as
    `repo.find` over an `In(nonNullIds) | IsNull()` where-clause union
    and then re-ordered client-side to honor the caller's chain order.
    That is correct, but the in-memory `Map` dedup by scope is necessary
    because the SQL `In` is a flat equality. The pattern is documented
    in the JSDoc.
  - `ScopedAiDefaultRepository.upsertForScope` does find-then-save
    rather than a SQL `UPSERT`, intentionally so a single
    `scopeNodeId = NULL` row is enforced (the comment explains this).
  - `HarnessConfigService.create` requires `custom:` prefix; a future
    PR may want to centralize the builtin-prefix check rather than
    re-implementing it in `update`/`remove`.
  - `HarnessRuntimeSelection` always passes `FALLBACK_HARNESS_ID = 'pi'`
    as the platform default, which couples this file to the registry
    always having a `pi` entry (true by design in
    `HarnessProviderRegistryService`).

## Open Questions

- The OAuth link service and controller are implemented but lack unit tests.
  Without them, regressions in the `oauthProviderId` →
  `OAuthLoginService.start` bridge or the secret-naming scheme could ship
  silently.
- `HarnessPolicy.assertMayUseHarness` is exported and tested in isolation
  but does not appear to be invoked from `HarnessConfigController`,
  `HarnessCredentialController`, or `HarnessOAuthController`. Whether
  policy enforcement is meant to be applied per-request (and where) is
  not visible from this directory alone — likely a separate scope
  (workflow-launch / kanban domain) handles that.
- `HarnessScopedDefaultsController.getPlatform` is mounted at
  `GET harness/scoped-defaults` (no path param) while `getForScope` is
  `GET harness/scoped-defaults/:scopeNodeId`. The route ordering looks
  fine in Nest, but a `scopeNodeId` of literal `"null"` would collide
  with the platform route — worth a contract-level confirmation that
  the API does not allow that.
- `HarnessRuntimeSelection` is consumed by the workflow step execution
  path (out of scope here) — its integration with
  `AiConfigurationService.resolveRunnerProviderConfig` and the ledger is
  verified at the unit level only.
