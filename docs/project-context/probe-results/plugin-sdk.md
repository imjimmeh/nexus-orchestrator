---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: plugin-sdk
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - packages/plugin-sdk/package.json
  - packages/plugin-sdk/src/index.ts
  - packages/plugin-sdk/src/plugin-manifest.types.ts
  - packages/plugin-sdk/src/plugin-manifest.schema.ts
  - packages/plugin-sdk/src/plugin-manifest.schema.spec.ts
  - packages/plugin-sdk/src/plugin-contribution.types.ts
  - packages/plugin-sdk/src/plugin-contribution.schema.ts
  - packages/plugin-sdk/src/plugin-contribution.schema.spec.ts
  - packages/plugin-sdk/src/plugin-runtime-protocol.types.ts
  - packages/plugin-sdk/src/plugin-runtime-protocol.schema.ts
  - packages/plugin-sdk/src/plugin-runtime-protocol.schema.spec.ts
  - packages/plugin-sdk/src/special-step-plugin.types.ts
  - packages/plugin-sdk/src/special-step-plugin.schema.ts
  - packages/plugin-sdk/src/special-step-plugin.schema.spec.ts
  - packages/plugin-sdk/type-tests/plugin-runtime-protocol.types.fixture.ts
source_paths:
  - packages/plugin-sdk/
updated_at: 2026-06-15T17:09:00Z
---

# Probe Result: Plugin SDK

## Narrative Summary

The `packages/plugin-sdk/` workspace is a fully implemented, standalone TypeScript library published as `@nexus/plugin-sdk` 0.0.1. It is the public, API-agnostic surface for plugin authors, providing Zod schemas and inferred TypeScript types for plugin manifests, contribution contracts, the versioned runtime protocol, and the special-step plugin interface. The package depends only on `@nexus/core` (for `IJob`) and `zod ^4.4.3`, with no NestJS, TypeORM, or API-tier coupling. The SDK is consumed by 51+ files across `apps/api/src/plugin-kernel/` and `packages/plugin-platform/`, and its `parsePluginManifest`, `parsePluginContribution`, and `parsePluginRuntimeProtocolMessage` helpers are the entry points used by the kernel lifecycle, contribution registry, and worker-process runtime adapter. All exported types and schemas are exercised by co-located Vitest specs (1,486 lines of tests across 4 spec files) plus a type-level fixture using `@ts-expect-error` assertions.

## Capability Updates

### Package Configuration
- **package.json**: Name `@nexus/plugin-sdk` v0.0.1, main/types point at `./dist/index.js` and `./dist/index.d.ts`. Scripts: `build` (clean + tsc build + type-tests), `lint`, `test` (vitest run). Dependencies: `@nexus/core` 0.0.1, `zod ^4.4.3`; devDependency: `vitest ^4.1.8`.
- **tsconfig.json**: Target ES2022, NodeNext module/resolution, strict, declaration + declarationMap + sourceMap, rootDir `src/`, outDir `dist/`.
- **tsconfig.build.json**: Extends base, excludes `src/**/*.spec.ts`, emits to dist.
- **tsconfig.type-tests.json**: Extends base, rootDir `.`, includes `src/**/*.ts` and `type-tests/**/*.ts`, noEmit true (used as type-check only).
- **vitest.config.ts**: Node environment, default vitest config.

### Public API Surface (src/index.ts)
- Re-exports schemas, types, and parser helpers from: `plugin-manifest`, `plugin-contribution`, `plugin-runtime-protocol`, `special-step-plugin` modules (8 barrel lines).

### Plugin Manifest Contract
- **plugin-manifest.types.ts (67 lines)** — Defines `PluginManifest`, `PluginNexusCompatibility` (pluginApiVersion, minVersion, maxVersion), `PluginEntrypoints` (main, optional worker), `PluginPermission` (5-kinds discriminated union), and frozen `pluginIsolationModes` (`none | worker_process | container`), `pluginTrustLevels` (`bundled | local_trusted | third_party | quarantined`), `pluginLifecycleStates` (`discovered | installed | scanned | enabled | disabled | quarantined | uninstalled`).
- **plugin-manifest.schema.ts (104 lines)** — Exports `pluginIsolationModeSchema`, `pluginTrustLevelSchema`, `pluginLifecycleStateSchema`, `pluginNexusCompatibilitySchema`, `pluginEntrypointsSchema`, `pluginPermissionSchema` (discriminated union with `.strict()`), `pluginManifestContributionSchema` (alias for `pluginContributionSchema`), and the top-level `pluginManifestSchema`. The top-level schema is `.strict()`, requires non-empty trimmed strings, at least one isolation mode, and uses `superRefine` to reject duplicate contribution ids with structured `path: ['contributions', index, 'id']` issue reporting. `parsePluginManifest(value)` parses and returns `PluginManifest`.

### Plugin Contribution Contract
- **plugin-contribution.types.ts (140 lines)** — Defines 6 contribution kinds as a discriminated union: `ToolContribution`, `WorkflowStepContribution`, `WorkflowHookContribution`, `EventSubscriptionContribution`, `CapabilityEndpointContribution`, `LegacySpecialStepContribution` (`special_step`). Frozen constants: `pluginContributionTypes`, `pluginOperationNameMaxLength` (255), `pluginOperationNamePattern` (`/^[a-z][a-z0-9_.:_-]*$/`), `workflowHookEventNames` (7 events: `workflow.run.started/completed/failed/cancelled` and `workflow.step.started/completed/failed`), `pluginSubscriptionDeliveryModes` (`blocking | non_blocking`), `pluginCapabilityEndpointVisibilities` (`workflow | tool | internal | plugin`).
- **plugin-contribution.schema.ts (163 lines)** — Per-kind config schemas with `.strict()` enforcement and defaults (operation defaults to `execute` / `handle` / `invoke`, delivery mode defaults to `non_blocking`, blocking defaults to `false`, retry config defaults to `{ maxAttempts: 3, initialDelayMs: 1_000, backoffMultiplier: 2 }`). `eventSubscriptionContributionConfigSchema` validates topics with a dot-segment pattern, range-checks retry bounds (1..10, 100..60_000, 1..10), and exposes a 17-entry `RESERVED_SPECIAL_STEP_TYPES` via the special-step schema (see below). `pluginContributionSchema` is a `z.discriminatedUnion('type', …)` over the 6 contribution kinds. `parsePluginContribution(value)` parses and returns `PluginContribution`.

### Runtime Protocol Contract
- **plugin-runtime-protocol.types.ts (233 lines)** — Defines `PLUGIN_RUNTIME_PROTOCOL_VERSION = '2026-05-17'` (as const), `PluginRuntimeProtocolVersion`, `PluginRuntimeMode`, recursive `PluginRuntimeJsonValue` / `PluginRuntimeJsonObject`, peer descriptor types, and 10 message types: `handshake.request`, `handshake.response`, `contributions.declare`, `invoke.request`, `invoke.response`, `event.deliver`, `health.check.request`, `health.check.response`, `shutdown`, `error`. The union type `PluginRuntimeProtocolMessage` is exported for downstream consumers.
- **plugin-runtime-protocol.schema.ts (460 lines)** — Comprehensive Zod schemas for every message type with strict bounds:
  - **Constants**: `PLUGIN_RUNTIME_PROTOCOL_METADATA_MAX_BYTES = 4096`, `PLUGIN_RUNTIME_PROTOCOL_PAYLOAD_MAX_BYTES = 4096`, `PLUGIN_RUNTIME_PROTOCOL_JSON_MAX_DEPTH = 5`, `PLUGIN_RUNTIME_PROTOCOL_IDENTIFIER_MAX_LENGTH = 255`, `PLUGIN_RUNTIME_PROTOCOL_ERROR_MESSAGE_MAX_LENGTH = 2048`.
  - **Identifier patterns**: `dottedIdentifierPattern` (pluginId, peerId, contributionId, eventIdentifier), `tokenIdentifierPattern` (correlationId, eventName), `topicIdentifierPattern` (allows optional `.*` wildcard), `errorCodePattern` (`/^[A-Z][A-Z0-9_]*$/`), `operationNamePattern` (from contribution types).
  - **`isJsonCompatible` + `createBoundedJsonSchema`**: Walk with WeakSet cycle detection, depth cap of 5, prototype allowlist (`Object.prototype` or null), array index ownership check via `Object.hasOwn`, and post-parse `JSON.stringify` UTF-8 byte-length cap using a module-scope `TextEncoder`. Rejects non-finite numbers, class instances, circular references, and oversized payloads.
  - **Per-message schemas**: Each of the 10 message types has a `.strict()` Zod schema. `contributions.declare` uses `superRefine` to reject duplicate contribution ids. `shutdown.reason` is constrained to `operationNamePattern`; `error.message` is bounded to 2048 chars and must not have leading/trailing whitespace.
  - `parsePluginRuntimeProtocolMessage(value)` parses and returns `PluginRuntimeProtocolMessage`.

### Special-Step Plugin Contract
- **special-step-plugin.types.ts (60 lines)** — Defines `SpecialStepPluginPermission` (4 kinds: network, filesystem, environment, secrets), `SpecialStepPluginHandlerManifest` (type, displayName, description?, inputContract), `SpecialStepPluginManifest`, `SpecialStepPluginExecutionContext` (carries `IJob` from `@nexus/core`), `SpecialStepPluginExecutionResult`, `SpecialStepPluginHandlerResult`, and the `SpecialStepPlugin` interface (read-only `manifest` + `handlers[]`). Exports `defineSpecialStepPlugin(plugin)` identity helper for ergonomic plugin authoring.
- **special-step-plugin.schema.ts (99 lines)** — `specialStepPluginPermissionSchema` (4-kind discriminated union, `.strict()`), `specialStepPluginHandlerManifestSchema` (strict), `specialStepPluginManifestSchema` (strict, requires at least 1 special step, uses `superRefine` to reject entries whose `type` is in `RESERVED_SPECIAL_STEP_TYPES` and to detect duplicate types). The reserved list (17 entries) includes core job types: `execution`, `register_tool`, `invoke_workflow`, `run_command`, `web_automation`, `emit_event`, `http_webhook`, `mcp_tool_call`, `git_operation`, `manage_tool_candidate`, `record_metadata`, `manage_execution`, `check_orchestration_status`, `hydrate_work_items_from_specs`, `transition_status`, `attempt_merge`, `manage_worktree`. `isReservedSpecialStepType(value)` is exported for callers.

## Health Findings

### Test Coverage
- **1,486 lines of Vitest specs** co-located with the source as `*.spec.ts`, which `tsconfig.build.json` excludes from the build output.
- `plugin-manifest.schema.spec.ts` (178 lines) — happy path, schema refusal cases, and integration with contribution schemas.
- `plugin-contribution.schema.spec.ts` (446 lines) — per-kind parsing, default operation application, unknown-field rejection, duplicate-id detection, legacy `special_step` manifest retention for EPIC-190 compatibility.
- `plugin-runtime-protocol.schema.spec.ts` (670 lines) — per-message parsing, identifier pattern enforcement, payload/metadata byte-bound enforcement, JSON depth enforcement, prototype rejection (custom `RuntimeOnlyValue` class), bounded JSON capacity tests, duplicate contribution id detection, invalid contribution shapes.
- `special-step-plugin.schema.spec.ts` (192 lines) — happy path, duplicate type rejection, reserved type rejection (`execution` is the canonical example used in the test).
- **Type-level fixture** in `type-tests/plugin-runtime-protocol.types.fixture.ts` asserts structural typing on `PluginContributionsDeclareMessage` and uses `@ts-expect-error` to confirm tool contributions require a `config` and that unknown config fields are rejected — fed through `tsconfig.type-tests.json` (noEmit) during `npm run build`.

### Code Quality
- All Zod object schemas use `.strict()` so unknown keys are rejected, preventing manifest drift.
- Schemas consistently use `nonEmptyTrimmedStringSchema = z.string().trim().min(1)` to fail fast on empty or whitespace-only values.
- Recursive JSON validation uses a WeakSet to avoid infinite recursion on cyclic inputs.
- `superRefine` callbacks report duplicate-id issues with `path: ['contributions', index, 'id']`, making the error directly actionable.
- No API-tier imports: the SDK depends only on `@nexus/core` and `zod`. There is no NestJS, TypeORM, or plugin-kernel leakage, preserving the documented split (kernel lifecycle in `apps/api`, contract validation in `packages/plugin-sdk`).

### Build / Tooling
- `npm run build` runs `clean` → `tsc -p tsconfig.build.json` (emits dist) → `tsc -p tsconfig.type-tests.json` (verifies type-level fixtures).
- `npm run test` runs `vitest run --config vitest.config.ts`.
- `npm run lint` invokes the workspace `eslint.config.mjs`.

## Open Questions

- **Manifest signature/checksum verification**: The schema accepts `checksum` and `signature` fields, but signature verification is not implemented inside the SDK; this is the responsibility of the API plugin-kernel and is not visible from this scope. Whether the kernel currently verifies these is a question for the `plugin-platform` / `plugin-kernel` scope.
- **Lifecycle state machine**: The SDK exports `pluginLifecycleStates` and a Zod enum, but the actual transition table and side effects live in `apps/api/src/plugin-kernel/plugin-lifecycle.service.ts`. The SDK intentionally does not enforce ordering — confirming the kernel owns the state machine would close a structural question.
- **Plugin platform package**: The companion `packages/plugin-platform/src` package was flagged as "minimal (placeholder, integration tests only)" in the 2026-06-02 `plugin-platform.md` probe. Whether that package remains a placeholder or has gained substantive code since then is outside this scope but is the most relevant adjacent risk.
- **Protocol version evolution**: `PLUGIN_RUNTIME_PROTOCOL_VERSION` is pinned to a single literal (`'2026-05-17'`). The protocol types accept a single-element array, so multi-version negotiation will require extending the version handling. No version-negotiation logic is visible in this scope.
- **Reserved special-step list maintenance**: The 17-entry `RESERVED_SPECIAL_STEP_TYPES` list is hand-maintained; future core job types added to `@nexus/core` must be reflected here, otherwise plugins could shadow them. There is no automated check in the SDK that the reserved list matches the kernel's actual reserved set.
