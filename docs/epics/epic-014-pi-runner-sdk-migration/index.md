# Epic 014: Pi-Runner SDK Migration & Modular Refactor

> **Note (2026-06-25):** The thin `SubagentOrchestratorService` facade was restored at `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`. See [ADR-0003](../../../architecture/adr/ADR-0003-restore-subagent-orchestrator-facade.md).

## Overview

Migrate the pi-runner execution plane from the low-level `@mariozechner/pi-agent-core` SDK to the full `@mariozechner/pi-coding-agent` SDK, which provides native session management (`SessionManager`), credential storage (`AuthStorage`), model resolution (`ModelRegistry`), and auto-compaction. Simultaneously refactor the monolithic `pi-runner.ts` into focused, testable modules and replace insecure environment-variable credential passing with a WebSocket-based configuration handshake.

## Motivation

1. **Session Management Gap**: The SDD specifies JSONL session lifecycle (pause, dehydrate, rehydrate, branch, compact) but `pi-agent-core` has no session management. These capabilities exist only in `@mariozechner/pi-coding-agent`.
2. **Broken Dehydration**: The SIGUSR1 pause signal is sent by `ContainerOrchestratorService.pauseContainer()` but the pi-runner has no handler for it — dehydration silently fails.
3. **Security Risk**: API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.) are passed as Docker container environment variables, visible via `docker inspect`.
4. **Untestable Monolith**: `pi-runner.ts` is a single 540-line file with tightly coupled concerns (config, model resolution, event mapping, WS client, orchestration, SDK initialization).
5. **JSONL Format Mismatch**: The validation service expects `{id, type, parent}` but coding-agent produces `{id, parentId, type: "session"|"message"|...}` with v3 format headers.

## Scope

### In Scope

- Replace `@mariozechner/pi-agent-core` + `@mariozechner/pi-ai` with `@mariozechner/pi-coding-agent`
- ESM module migration for pi-runner package
- Modular refactor into `config.ts`, `session-factory.ts`, `telemetry-bridge.ts`, `orchestrator-client.ts`, `main.ts`, `mock-session.ts`
- WebSocket-based configuration handshake (secrets never in Docker env)
- WebSocket `dehydrate` command replacing SIGUSR1 signal
- JSONL validation alignment with coding-agent v3 format
- Session hydration alignment with native `SessionManager`
- Unit tests for all new modules
- Dockerfile updates for ESM entrypoint
- Core interface additions (`IRunnerConfigPayload`)

### Out of Scope

- Changes to workflow engine logic
- Database schema changes
- UI/frontend changes
- New tool registry features

## Dependencies

- `@mariozechner/pi-coding-agent` npm package (ESM-only)
- `@sinclair/typebox` for custom tool schemas
- Existing: Redis, PostgreSQL, Docker, Socket.io

---

## Phase 1: SDK Package Migration

**Blocks all subsequent phases.**

### Step 1.1 — Replace pi-runner dependencies

- Remove `@mariozechner/pi-agent-core` and `@mariozechner/pi-ai` from dependencies
- Remove `pi-mono` from optionalDependencies
- Add `@mariozechner/pi-coding-agent` as primary dependency
- Add `@sinclair/typebox` as dependency (for custom tool schemas)
- **Files**: `packages/pi-runner/package.json`

### Step 1.2 — Switch module system to ESM

- `pi-coding-agent` is ESM-only; pi-runner currently targets CommonJS
- Update `tsconfig.json`: `module: "NodeNext"`, `moduleResolution: "NodeNext"`
- Update `package.json`: add `"type": "module"`
- Remove `dynamicImport` hack and `require()` calls
- **Files**: `packages/pi-runner/tsconfig.json`, `packages/pi-runner/package.json`

### Step 1.3 — Remove legacy runtime classes

- Delete `PiAgentCoreRuntime` class (200+ lines of manual model resolution and event mapping)
- Delete `loadAgentCtor()` function (3-tier SDK fallback chain)
- Delete `extractReadableText()` function (68 lines; SDK events provide typed fields)
- Delete helper functions: `hasProviderCredentials()`, `listConfiguredProviderKeys()`
- **Files**: `packages/pi-runner/src/pi-runner.ts` (gutted)

---

## Phase 2: Pi-Runner Modular Refactor

Split the monolithic pi-runner into focused, testable modules.

### Step 2.1 — `src/config.ts`

- Read and validate container-injected configuration
- Read env vars: `AGENT_JWT`, `WEBSOCKET_URL`, `STEP_ID`, `WORKFLOW_RUN_ID`
- Validate required fields, fail fast with clear error messages
- Exports typed `PiRunnerConfig` interface and `loadConfig()` function
- **New file**: `packages/pi-runner/src/config.ts`

### Step 2.2 — `src/session-factory.ts`

- Wrap `createAgentSession()` with Nexus-specific defaults
- Handle `SessionManager.open(path)` for rehydrated sessions or fresh in-memory sessions
- Configure `AuthStorage.inMemory()` with runtime API key injection
- Create `ModelRegistry` from auth storage, resolve model
- Set system prompt override, configure compaction settings
- **New file**: `packages/pi-runner/src/session-factory.ts`

### Step 2.3 — `src/telemetry-bridge.ts`

- Bridge `AgentSession` events to Nexus WebSocket telemetry gateway
- Map SDK events: `turn_start`, `message_update`, `tool_execution_start/end`, `turn_end`, `agent_end`
- Replace `extractReadableText()` — SDK events have typed `text_delta` fields
- **New file**: `packages/pi-runner/src/telemetry-bridge.ts`

### Step 2.4 — `src/orchestrator-client.ts`

- Manage WebSocket connection to orchestrator
- Handle config-handshake protocol (wait for `configure` event)
- Listen for orchestrator commands: `dehydrate`, `abort`
- Expose typed methods: `connect()`, `waitForConfig()`, `emit()`, `onCommand()`
- **New file**: `packages/pi-runner/src/orchestrator-client.ts`

### Step 2.5 — `src/main.ts` (entry point)

- Clean orchestration: loadConfig → connect → waitForConfig → createSession → bridgeTelemetry → execute → handle dehydrate/exit
- **Files**: `packages/pi-runner/src/main.ts` (rewrite)

### Step 2.6 — `src/mock-session.ts`

- Rewrite `pi-mono-mock.ts` as mock `AgentSession`-compatible object
- Emit same event types as real coding-agent SDK
- Activated by `PI_MOCK=true` env var
- **New file**: `packages/pi-runner/src/mock-session.ts` (replaces `pi-mono-mock.ts`)

---

## Phase 3: Model/Provider Config via WebSocket

Replace env-var credential passing with WebSocket config handshake.

### Step 3.1 — Define config handshake protocol

- After pi-runner connects with `AGENT_JWT`, orchestrator sends `configure` event:
  ```typescript
  interface IRunnerConfigPayload {
    provider: string; // "anthropic", "openai", etc.
    model: string; // "claude-sonnet-4-5", "gpt-4o-mini"
    apiKey: string; // The actual secret
    baseUrl?: string; // Optional custom endpoint
    systemPrompt: string;
    temperature: number;
    thinkingLevel: "off" | "low" | "medium" | "high";
    resumeNodeId?: string;
  }
  ```
- Pi-runner waits for this event before creating a session
- Timeout after 30s → fail with clear error
- **Files**: `packages/core/src/interfaces/index.ts`

### Step 3.2 — Update telemetry gateway

- After authenticating `role: "agent"` socket, emit `configure` event with resolved settings
- Retrieve config from short-lived Redis key (set by step-execution consumer pre-launch)
- **Files**: `apps/api/src/telemetry/telemetry.gateway.ts`

### Step 3.3 — Update step-execution consumer

- Stop passing API keys as container env vars
- Store resolved config in Redis with TTL (keyed by `workflowRunId:stepId`)
- Keep passing only non-secret env vars: `AGENT_JWT`, `WEBSOCKET_URL`, `WORKFLOW_RUN_ID`, `STEP_ID`
- **Files**: `apps/api/src/workflow/step-execution.consumer.ts`

### Step 3.4 — WebSocket dehydrate command

- Gateway sends `dehydrate` command to connected agent socket
- Pi-runner receives → abort session → wait for idle → dispose → exit
- Replace SIGUSR1 signal approach
- Update `ContainerOrchestratorService.pauseContainer()` to use WS command
- **Files**: `apps/api/src/docker/container-orchestrator.service.ts`, `apps/api/src/telemetry/telemetry.gateway.ts`

### Step 3.5 — Update subagent orchestrator

- `spawnSubagent()` sends `dehydrate` via WebSocket instead of SIGUSR1
- Wait for `dehydrated` acknowledgment before session extraction
- **Files**: `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts` (facade; delegates spawn/dehydrate to `SubagentProvisioningService`)

---

## Phase 4: Session Management Alignment

Align orchestrator session handling with coding-agent's native JSONL tree format.

### Step 4.1 — Update JSONL validation

- Accept coding-agent v3 format: session header + entries with `parentId`
- Support entry types: `session`, `message`, `compaction`, `branch_summary`, `thinking_level_change`, `model_change`, `label`, `session_info`, `custom`, `custom_message`
- **Files**: `apps/api/src/session/jsonl-validation.service.ts`

### Step 4.2 — Update session hydration

- Dehydration: extract session file in native coding-agent format as-is
- Rehydration: inject native JSONL file; pi-runner uses `SessionManager.open(path)` to load
- Pass `resumeNodeId` via WebSocket `configure` event instead of env var
- **Files**: `apps/api/src/session/session-hydration.service.ts`

### Step 4.3 — Update `appendSystemResultNode()`

- Use `custom_message` type with `customType: "nexus_system"` and `parentId` field
- **Files**: `apps/api/src/session/session-hydration.service.ts`

### Step 4.4 — Wire native compaction

- Enable coding-agent's auto-compaction inside containers via `SettingsManager`
- Keep server-side distillation for stored/offline sessions
- **Files**: `packages/pi-runner/src/session-factory.ts`

---

## Phase 5: Cleanup & Consistency

### Step 5.1 — Remove legacy log markers

- Delete `NEXUS_PI_*` environment log patterns
- **Files**: `packages/pi-runner/src/main.ts`

### Step 5.2 — Update Dockerfiles

- ESM entrypoint: `node dist/main.js`
- Remove env var defaults for `MODEL`, `SYSTEM_PROMPT`, etc.
- **Files**: `docker/Dockerfile.light`, `docker/Dockerfile.heavy`

### Step 5.3 — Update E2E tests

- ~~Update obsolete live AI E2E test for new SDK markers~~ (file deleted as obsolete)
- **Files**: ~~obsolete live AI E2E test~~

### Step 5.4 — Update core interfaces

- Add `IRunnerConfigPayload` to `@nexus/core`
- Update `IPiSessionTree` documentation for coding-agent format
- **Files**: `packages/core/src/interfaces/index.ts`

---

## Verification Criteria

1. `npm run build --workspace=packages/pi-runner` compiles without errors (ESM)
2. `docker build -f docker/Dockerfile.light .` builds successfully
3. `npm run test --workspace=apps/api` — all unit tests pass
4. `npm run test:e2e --workspace=apps/api` — all E2E tests pass
5. Functional tests: simple and complex modes pass
6. No API keys appear in `docker inspect` env section
7. Session JSONL extracted from containers matches coding-agent v3 format
8. Dehydrate → rehydrate cycle preserves session tree with correct leaf pointer

## Technical Decisions

| Decision                             | Rationale                                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| WebSocket config delivery            | Secrets not exposed in `docker inspect`; aligns with `AuthStorage.setRuntimeApiKey()` pattern      |
| No RPC mode                          | Containers communicate over network, not subprocess pipes                                          |
| Align to coding-agent JSONL natively | No format translation layer; validation updated to understand v3 format directly                   |
| Native in-container compaction       | Let SDK handle auto-compaction during execution; server-side distillation for stored sessions only |
| ESM migration                        | Required by `@mariozechner/pi-coding-agent` (ESM-only package)                                     |
| WebSocket dehydrate replaces SIGUSR1 | More reliable, testable; current SIGUSR1 approach has no handler anyway                            |
| Clean cutover (no feature flags)     | Reduces complexity; validated by comprehensive test coverage                                       |

## Notes

- **Session file location**: Use `SessionManager.create(cwd, sessionDir)` with explicit `sessionDir = "/app/.pi/agent"` or `SessionManager.open(path)` for rehydration. Must align with Docker `getArchive`/`putArchive` paths.
- **Extension loading**: Use `DefaultResourceLoader({ additionalExtensionPaths })` for tool discovery from `/app/extensions`.
- The `pi-mono` optional dependency was never actually installed and can be removed without impact.
