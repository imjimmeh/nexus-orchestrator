---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: harness-engine-pi
outcome: success
inferred_status: implemented
confidence_score: 0.9
evidence_refs:
  - packages/harness-engine-pi/src/pi-engine.ts
  - packages/harness-engine-pi/src/pi-harness-session.ts
  - packages/harness-engine-pi/src/map-pi-event.ts
  - packages/harness-engine-pi/src/index.ts
  - packages/harness-engine-pi/src/pi-engine.resume.spec.ts
  - packages/harness-engine-pi/src/pi-engine.suspend.spec.ts
  - packages/harness-engine-pi/test/map-pi-event.test.ts
  - packages/harness-engine-pi/test/pi-engine.provider-auth.test.ts
  - packages/harness-engine-pi/test/pi-engine.tool-allowlist.test.ts
  - packages/harness-engine-pi/test/pi-engine.tool-dedup.test.ts
  - packages/harness-engine-pi/test/pi-engine.tool-name-sanitization.test.ts
  - packages/harness-engine-pi/test/pi-harness-session.test.ts
  - packages/harness-engine-pi/test/golden/golden-path.test.ts
  - packages/harness-engine-pi/package.json
  - packages/harness-engine-pi/tsconfig.build.json
  - packages/harness-engine-pi/vitest.config.ts
  - packages/harness-conformance/test/conformance/pi.conformance.test.ts
  - docker/Dockerfile.heavy
  - docker/Dockerfile.light
  - packages/harness-runtime/src/kernel.ts
  - packages/harness-runtime/src/engine/harness-engine.types.ts
  - packages/core/src/interfaces/harness-capabilities.ts
source_paths:
  - packages/harness-engine-pi/src
updated_at: 2026-06-15T17:17:40.000Z
---

# Probe Result: Harness Engine - Pi

## Narrative Summary

`@nexus/harness-engine-pi` is a fully implemented engine adapter that wires
the `@earendil-works/pi-coding-agent` SDK into the harness-runtime kernel as a
pluggable `HarnessEngine` (harness id `"pi"`). It is the direct successor of
the legacy `pi-runner` session-factory / telemetry-bridge roles (which are
retired under EPIC-196), now scoped to a single package with a self-registration
side-effect and a tight set of responsibilities: build an `AgentSession`,
register governed and built-in tools, and map SDK events to the kernel's
`CanonicalSessionEvent` shape.

The engine implements two correctness-critical behaviors beyond the
straightforward wire-up: durable-await suspend wiring (abort the in-flight SDK
turn and emit a clean `agent_end` with `stopReason: "suspended"`) and
session-resume robustness (`SessionManager.open` + `resumeNodeId` branch plus
`skipTrailingAssistantLeaf` that rewinds past unresumable assistant leaves
left by aborts or spurious re-dispatches). Both are guarded by dedicated
co-located spec files (`pi-engine.suspend.spec.ts`, `pi-engine.resume.spec.ts`).

The package is built into both execution-container images
(`docker/Dockerfile.heavy` and `docker/Dockerfile.light`), is exercised by the
cross-engine `harness-conformance` suite (`pi.conformance.test.ts`), and is
referenced from the kernel loader, conformance alias map, and runtime docs.

## Capability Updates

- **`PiEngine` class** (`src/pi-engine.ts`): implements `HarnessEngine` with
  `id = "pi"` and `capabilities = PI_CAPABILITIES` (from
  `packages/core/src/interfaces/harness-capabilities.ts` — supports resume,
  branching, subagents, war room, thinking levels, `api_key` and `oauth`
  auth). `validate()` requires `model.provider`, `model.model`, and
  `model.auth`. `createSession()` builds:
  - `AuthStorage.inMemory(...)` seeded with either an OAuth credential
    (per `toUpstreamOAuthCredential`) or a runtime API key
    (`authStorage.setRuntimeApiKey`) for `api_key` flows.
  - `ModelRegistry.inMemory(authStorage)` plus a custom-model shim
    (`createCustomModel` for legacy OpenAI-compat baseUrl providers that lack
    a `providerConfig.models` entry) — both the API key and the custom model
    are bound to the synthetic "openai" provider so `getApiKeyAndHeaders(model)`
    resolves correctly (regression test:
    `test/pi-engine.provider-auth.test.ts`).
  - `SessionManager.open`/`create` with optional `branch(resumeNodeId)` and
    `skipTrailingAssistantLeaf` to avoid
    "Cannot continue from message role: assistant" aborts on durable-await
    resumes and spurious re-dispatches (kanban-1fbn).
  - `SettingsManager.inMemory()` and a `DefaultResourceLoader` whose
    `systemPrompt` is rewritten to use the sanitized tool names.
  - Built-in SDK coding/read-only tools filtered by the API-written
    `_sdk_tool_allowlist.json` (`SDK_TOOL_ALLOWLIST_FILENAME` from
    `packages/core/src/common/container-paths.ts`); a missing allowlist leaves
    the built-ins untouched (back-compat, `null !== []`). Governed tools are
    never touched by the allowlist.
  - Tool deduplication across built-ins and governed tools (`dedupeTools`)
    before the names are handed to `createAgentSession`. A governed tool
    that overlaps a built-in name (e.g. `"read"`) is registered once.
  - Tool-name sanitization to satisfy the OpenAI `^[a-zA-Z0-9_-]+$` pattern
    (e.g. `kanban.project_state` → `kanban_project_state`) with a
    `sanitizedToOriginal` map passed through to telemetry and the system
    prompt rewrite.
  - A `terminate` result from a governed tool (await_agent_workflow /
    delegate_*) triggers `sessionRefs.harness.suspend()` and
    `sessionRefs.agent?.abort()` *before* the SDK's next LLM turn, breaking
    the re-call loop (kanban-atuq).
  - `registerEngine("pi", () => new PiEngine())` at module load — the engine
    is discoverable through the kernel's registry without explicit wiring.

- **`PiHarnessSession` class** (`src/pi-harness-session.ts`): wraps an
  `AgentSession` and satisfies the `HarnessSession` contract
  (`prompt`, `abort`, `subscribe`, `dispose`). The `subscribe` handler:
  - Intercepts `message_update / assistantMessageEvent: "text_end"` to
    accumulate the streamed response (used to populate `turn_end.output.response`
    because the real `AssistantMessage` does not carry a top-level `text`
    field). The accumulator resets after each `turn_end` so subsequent turns
    start fresh.
  - Swallows a `turn_end` and converts the terminal `agent_end` into a
    synthetic suspended `agent_end` with
    `{ ok: true, stopReason: "suspended", suspended: true }` when
    `suspend()` was called. A guard (`suspendEnded`) ensures only one
    synthetic end is emitted.
  - Re-maps each event through `mapPiEventToCanonical` with the
    `sanitizedToOriginal` map so downstream telemetry sees canonical
    `kanban.project_state` rather than the provider-safe
    `kanban_project_state`.

- **`mapPiEventToCanonical`** (`src/map-pi-event.ts`): pure function that
  translates raw SDK events (`turn_start`, `tool_execution_start`,
  `tool_execution_update`, `tool_execution_end`, `turn_end`, `agent_end`,
  `agent_error`) into `CanonicalSessionEvent`; returns `null` for unrecognised
  event types so callers can ignore them. Handles reverse tool-name mapping
  for telemetry and extracts `stopReason`/`response`/`errorMessage`/`usage`
  from the `turn_end.message` shape (including the path where `text` is a
  top-level field on the AssistantMessage). `agent_end` extraction walks the
  `messages[].content` array for `type: "text"` blocks.

- **Index barrel** (`src/index.ts`): re-exports `PiEngine`,
  `PiHarnessSession`, and `mapPiEventToCanonical` as the package public
  surface.

- **Side effects**: `src/pi-engine.ts` calls `registerEngine("pi", ...)` at
  module load, so a downstream entrypoint that imports the package
  (e.g. `harness-runtime/main.ts`) needs no engine-specific wiring beyond
  `HARNESS_ID=pi`.

## Health Findings

- **Test coverage (8 spec files, ~1.7k LOC of tests, 1.0k LOC of source
  excluding specs)**:
  - `src/pi-engine.resume.spec.ts` (286 LOC) — regression suite for resume
    paths: opens existing session, creates fresh, branches on
    `resumeNodeId`, does not branch when not given, branches past an aborted
    assistant leaf, does not branch on a non-assistant tail, branches past
    a `end_turn` assistant leaf, branches past a `toolUse` assistant leaf.
  - `src/pi-engine.suspend.spec.ts` (240 LOC) — durable-await wiring:
    aborts and suspends on `terminate: true`, no-op on a normal tool result.
  - `test/map-pi-event.test.ts` (57 LOC) — `tool_execution_start` mapping,
    reverse-name restoration, `turn_end` ok/response/stopReason.
  - `test/pi-engine.provider-auth.test.ts` (109 LOC) — OpenAI-compat
    provider and the custom-model-must-match-registered-provider
    regression.
  - `test/pi-engine.tool-allowlist.test.ts` (149 LOC) — built-in filtering
    by `_sdk_tool_allowlist.json`, governed tools are not filtered,
    absent-allowlist preserves all built-ins.
  - `test/pi-engine.tool-dedup.test.ts` (198 LOC) — overlapping names
    (e.g. governed `read` vs built-in `read`) are passed to
    `createAgentSession` exactly once; `ModelRegistry.inMemory` is called
    as a static factory.
  - `test/pi-engine.tool-name-sanitization.test.ts` (133 LOC) — dot-bearing
    tool names (`kanban.project_state`, `kanban.orchestration_timeline`) are
    sanitized for the SDK and the system prompt is rewritten accordingly.
  - `test/pi-harness-session.test.ts` (256 LOC) — `text_end` accumulation
    used for `turn_end.response`, reset between turns, fallback to
    `message.text`, ignore `text_delta`, suspended `agent_end` conversion,
    suppression of aborted `turn_end` after suspend, normal `agent_end`
    passthrough.
  - `test/golden/golden-path.test.ts` (235 LOC) — end-to-end characterization
    test driving `PiEngine.createSession` + `subscribe` + `prompt` against
    a scripted mock session, asserting the full canonical event sequence
    via `toMatchInlineSnapshot`.
- **Conformance**: the engine is also exercised by
  `packages/harness-conformance/test/conformance/pi.conformance.test.ts`
  (C1–C? cases including `validate()` ok, `createSession()` returns a
  `HarnessSession`, and a `turn_start` is emitted).
- **Build / packaging**: `package.json` declares the build script
  (`tsc -p tsconfig.build.json`), vitest config picks up
  `src/**/*.spec.ts` and `test/**/*.test.ts`, and `tsconfig.build.json`
  excludes specs from `dist/`. The conformance suite uses a vitest alias
  (`@nexus/harness-engine-pi` → `packages/harness-engine-pi/src/index.ts`)
  so the package does not need to be pre-built to run conformance.
- **Container integration**: `docker/Dockerfile.heavy` and
  `docker/Dockerfile.light` both `COPY packages/harness-engine-pi` and run
  `npx turbo run build --filter=@nexus/harness-engine-pi`, then copy
  `dist/` into the runtime image. Package is published as
  `@nexus/harness-engine-pi` and listed in `package-lock.json`.
- **Code quality**: strict TypeScript (`"strict": true`, `module: NodeNext`,
  `target: ES2022`); clean barrel pattern; no observed TODOs or
  `console.log`s in the source under `src/`. The two `*.spec.ts` files
  that live in `src/` are intentionally co-located next to the code they
  guard (resume / suspend) and are excluded from the build by
  `tsconfig.build.json`.
- **Dependencies**: pinned to `@earendil-works/pi-coding-agent@^0.78.0`
  (SDK), `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai`
  (types/OAuth), `@nexus/core` (capabilities, config types, container
  paths), `@nexus/harness-runtime` (SPI). Test-only: `cross-env`,
  `vitest`, `typescript`.

## Open Questions

- The conformance suite (`packages/harness-conformance/test/conformance/pi.conformance.test.ts`)
  covers C1–C3 visible in the head of the file; the full set of cases
  (C4+ for OAuth, suspend, tool-allowlist) is not visible in the first
  200 lines and was not exhaustively read here. Whether the conformance
  contract is fully covered for the suspend / OAuth / provider paths
  should be confirmed by a dedicated conformance probe.
- The Docker images build `harness-engine-pi` and `harness-runtime` in
  topological order via `turbo run build --filter=…`, but there is no
  smoke test in the probe scope that proves the resulting image boots
  end-to-end with `HARNESS_ID=pi`. The conformance suite and the
  harness-runtime `kernel.spec.ts` are the closest in-tree guards.
- `pi-runner` (the predecessor) is still referenced throughout the repo
  in docs, `.rpiv/`, `package-lock.json`, and a few historical beads
  (`kanban-c9p`, `kanban-edb`, `kanban-2g1i`, etc.). Some entries are
  marked closed; the cleanup plan is documented in
  `docs/specs/EPIC-196-pluggable-harness/08-migration-and-sequencing.md`
  and `PLAN-196-M-documentation.md`. Whether all of those references are
  fully retired is outside this probe's scope.
- The engine registers itself as a side effect of module import
  (`registerEngine("pi", ...)`). This is consistent with the kernel SPI
  but means importing the package twice in the same process would be
  idempotent only because the registry overwrites with a new factory —
  harmless today, worth noting if the kernel ever moves to
  "register-once" semantics.
