---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: harness-runtime
outcome: success
inferred_status: implemented
confidence_score: 0.85
evidence_refs:
  - packages/harness-runtime/src/kernel.ts
  - packages/harness-runtime/src/main.ts
  - packages/harness-runtime/src/index.ts
  - packages/harness-runtime/src/engine/harness-engine.types.ts
  - packages/harness-runtime/src/engine/session-context.types.ts
  - packages/harness-runtime/src/config/config.ts
  - packages/harness-runtime/src/config/config.types.ts
  - packages/harness-runtime/src/gateway/orchestrator-client.ts
  - packages/harness-runtime/src/gateway/orchestrator-client.types.ts
  - packages/harness-runtime/src/governance/wrap-tool.ts
  - packages/harness-runtime/src/governance/check-permission-client.ts
  - packages/harness-runtime/src/governance/check-permission-client.types.ts
  - packages/harness-runtime/src/server/server.ts
  - packages/harness-runtime/src/server/server.execution.ts
  - packages/harness-runtime/src/server/server.execution.types.ts
  - packages/harness-runtime/src/server/server.types.ts
  - packages/harness-runtime/src/server/session-completion.helpers.ts
  - packages/harness-runtime/src/server/session-completion.types.ts
  - packages/harness-runtime/src/server/checkpoint-wiring.ts
  - packages/harness-runtime/src/server/checkpoint-wiring.types.ts
  - packages/harness-runtime/src/telemetry/forwarder.ts
  - packages/harness-runtime/src/tools/mounted-tools.ts
  - packages/harness-runtime/src/tools/mounted-tools.types.ts
  - packages/harness-runtime/src/tools/api-callback.ts
  - packages/harness-runtime/src/tools/external-mcp-callback.ts
  - packages/harness-runtime/src/tools/external-mcp-callback.types.ts
  - packages/harness-runtime/src/tools/host-mount-scope.ts
  - packages/harness-runtime/src/tools/host-mount-scope.types.ts
  - packages/harness-runtime/src/tools/build-tool-catalog.ts
  - packages/harness-runtime/src/tools/tool-name-normalization.ts
  - packages/harness-runtime/src/tools/http-utils.ts
  - packages/harness-runtime/src/checkpoint/session-checkpoint-writer.ts
  - packages/harness-runtime/src/checkpoint/session-checkpoint-writer.types.ts
  - packages/harness-runtime/src/checkpoint/file-sidecar-sink.ts
  - packages/harness-runtime/src/session/v3-session-writer.ts
  - packages/harness-runtime/src/session/v3-session-writer.types.ts
  - packages/harness-runtime/src/kernel.spec.ts
  - packages/harness-runtime/src/server/server.checkpoint.spec.ts
  - packages/harness-runtime/src/server/session-completion.helpers.spec.ts
  - packages/harness-runtime/src/checkpoint/session-checkpoint-writer.spec.ts
  - packages/harness-runtime/src/checkpoint/file-sidecar-sink.spec.ts
  - packages/harness-runtime/src/tools/api-callback.spec.ts
  - packages/harness-runtime/src/tools/build-tool-catalog.spec.ts
  - packages/harness-runtime/src/tools/tool-name-normalization.spec.ts
  - packages/harness-runtime/test/config/config.test.ts
  - packages/harness-runtime/test/engine/spi-contract.test.ts
  - packages/harness-runtime/test/governance/wrap-tool.test.ts
  - packages/harness-runtime/test/kernel/engine-load.test.ts
  - packages/harness-runtime/test/server/session-completion.helpers.test.ts
  - packages/harness-runtime/test/session/v3-session-writer.test.ts
  - packages/harness-runtime/test/tools/host-mount-scope.test.ts
  - packages/harness-runtime/package.json
  - packages/harness-runtime/vitest.config.ts
  - packages/harness-runtime/tsconfig.json
  - packages/harness-runtime/tsconfig.build.json
  - docker/Dockerfile.heavy
  - docker/Dockerfile.light
  - docker/Dockerfile.claude-code
  - packages/harness-engine-pi/src/pi-engine.ts
  - packages/harness-engine-claude-code/src/claude-code-engine.ts
source_paths:
  - packages/harness-runtime/src
updated_at: 2026-06-15T17:21:49.000Z
---

# Probe Result: Harness Runtime Kernel

## Narrative Summary

`@nexus/harness-runtime` is a fully implemented, engine-agnostic kernel
package that serves as the execution plane for the Nexus orchestrator's
pluggable harness runtime. The package is the direct successor of the
legacy `pi-runner` and is one of five workspace packages introduced under
EPIC-196 (the others being `harness-engine-pi`, `harness-engine-claude-code`,
`harness-conformance`, and `gitops-contracts`). The kernel exports a
deliberate, well-typed SPI (`HarnessEngine`, `HarnessSession`,
`HarnessSessionContext`, `registerEngine`/`loadEngine`/`assertTelemetryVersion`,
plus governance wrappers, tool loaders, an HTTP server, a WebSocket
gateway client, checkpoint writers, and a v3 session JSONL writer) that
both engine packages consume as direct dependencies. The bootstrap
sequence (`main.ts` → `startKernel()` in `kernel.ts`) is clean and
seven-stepped: env config → engine load + telemetry version guard →
orchestrator handshake → engine validation → governance wiring → mounted
tool load + governance wrap → HTTP server start with engine injected.

The package is built into all three execution container images
(`Dockerfile.heavy`, `Dockerfile.light`, `Dockerfile.claude-code`),
exercised by a substantial test suite (7 `*.spec.ts` files in `src/`
plus 7 `*.test.ts` files in `test/`, ~1.3k LOC of tests against ~2.6k
LOC of source), and structurally referenced from the conformance
package's `vitest.config.ts` aliases.

One partial finding: the `host-mount-scope` guard utilities are fully
implemented and tested (`applyHostMountScopeGuards`,
`readHostMountScopeManifest`, 345-LOC test file covering path
scoping, recursive read traversal, and read-only binding rejection),
and exported from the package barrel — but the kernel's bootstrap never
invokes them. The function is therefore a reusable library, not a kernel
behavior, on this revision.

## Capability Updates

### Engine SPI
- **`HarnessEngine` / `HarnessSession` interfaces**
  (`src/engine/harness-engine.types.ts`): the public contract a runtime
  engine must satisfy. `HarnessSession` exposes `prompt(message)`,
  `abort()`, `subscribe(onEvent) → unsubscribe`, `dispose()`, and an
  optional `getProducedSessionId()` for resume (used by claude-code's
  session id, propagated as `producedSessionId` in the step result).
  `HarnessEngine` exposes `id`, `capabilities`, `validate(config)`, and
  `createSession(config, ctx)`; the optional `executeCommand(req)` lets
  an engine override the default `sh -c` shell execution.
- **`HarnessSessionContext`**
  (`src/engine/session-context.types.ts`): the per-session context handed
  to engines. Contains `governedTools: CanonicalToolDefinition[]` (for
  `execute_wrapped` engines like PI — governance already baked in),
  `toolCatalog: CanonicalToolSpec[]` (for `permission_callback` engines
  like claude-code — un-governed, engine applies governance via
  `canUseTool`), `checkPermission(toolName, params) → PermissionDecision`
  (`allowed` / `denied` / `approval_required`), and filesystem paths
  (`workspacePath`, `agentDir`, `extensionsPath`, `sessionPath`).
- **Capability/test contract** is guarded by
  `test/engine/spi-contract.test.ts` (FakeSession/FakeEngine test fixture
  emitting canonical `turn_start`).

### Engine registry & telemetry contract
- **Engine registry** (`src/kernel.ts`): a `Map<string, () => HarnessEngine>`
  with `registerEngine(id, factory)` and `loadEngine(harnessId)` (throws
  if unregistered). Engine modules self-register as a side effect of
  import: `harness-engine-pi/src/pi-engine.ts` does
  `registerEngine("pi", () => new PiEngine())`,
  `harness-engine-claude-code/src/claude-code-engine.ts` does
  `registerEngine("claude-code", () => new ClaudeCodeEngine())`. No
  explicit wiring in `main.ts` beyond `HARNESS_ID`.
- **Telemetry contract guard** (`src/kernel.ts`): `KERNEL_TELEMETRY_VERSION
  = "v1"`, `assertTelemetryVersion(caps)` throws on mismatch. Engine
  capabilities are sourced from `@nexus/core` (`PI_CAPABILITIES`,
  `CLAUDE_CODE_CAPABILITIES`).
- **Tested** by `test/kernel/engine-load.test.ts` (accept/reject paths
  for `telemetryContractVersion`).

### Config loader
- **`loadConfig(env)`** (`src/config/config.ts`): validates and resolves
  the env vars the API injects. Requires `AGENT_JWT`, `STEP_ID`, and
  either `WORKFLOW_RUN_ID` or `CHAT_SESSION_ID`. Defaults
  `sessionPath`/`extensionsPath` to the `CONTAINER_SESSION_PATH` /
  `CONTAINER_EXTENSIONS_PATH` constants from `@nexus/core`
  (`/opt/harness-runtime/agent/session.jsonl`,
  `/opt/pi-runner/extensions`). Resolves `HARNESS_ID` through
  `isHarnessId(...)` (allows `"pi"`, `"claude-code"`, or `custom:*`).
  `isChatSession = !!CHAT_SESSION_ID && !WORKFLOW_RUN_ID` is used by the
  governance client to route `chat_session_id` vs `workflow_run_id`.
- **`HarnessEnvConfig`** type (`src/config/config.types.ts`) is the
  kernel's public env surface; thrown errors are `ConfigValidationError`.
- **Tested** by `test/config/config.test.ts` (default + override
  behavior for `extensionsPath` and `sessionPath`).

### HTTP server
- **`startServer({ envConfig, client, engine, ctx, portOverride })`**
  (`src/server/server.ts`): a long-lived `http.createServer` exposing
  - `GET  /health` — readiness probe (returns `{ status: "ok" }`).
  - `POST /execute/agent` — runs an agent step (foreground or
    background) via `executeAgentStep`. Returns 503 if the orchestrator
    WebSocket is not yet connected or the server is shutting down.
    Returns 400 with a list of missing required fields
    (`provider`, `model`, `auth`, `stepId`).
  - `POST /execute/command` — executes a shell command via
    `defaultExecuteCommand` (uses `execFile("sh", ["-c", ...])`, 30s
    default timeout, 5min cap) or the engine's `executeCommand(req)`
    override if provided.
  - `POST /shutdown` — graceful teardown (sets `shuttingDown` flag,
    disconnects the orchestrator client, closes the server).
  - Default port 8374 (matches `EXPOSE 8374` in all three Dockerfiles).
  - `await new Promise(...)` for `server.listen`; non-blocking
    `client.connect()` after listen.
- **`executeAgentStep(...)`**
  (`src/server/server.execution.ts`): validates auth (`resolveRequestAuth`),
  builds the `HarnessRuntimeConfig`, calls `engine.createSession(...)`,
  wires a checkpoint writer via `maybeCreateCheckpointWriter` when
  `SESSION_CHECKPOINT_PATH` is set, subscribes to the session, and runs
  in either background (fire-and-forget, returns `{ ok: true,
  response: "" }` immediately) or foreground mode (returns
  `AgentStepResult` with `ok`, `response`, optional `error`,
  `producedSessionId`, and `suspended` flag). Includes a 30-min
  `AGENT_SESSION_TIMEOUT_MS` race; full error stack is logged to stderr
  via `logAgentExecutionError` so SDK-internal failures (e.g. "Cannot
  continue from message role: assistant") remain locatable.
- **`defaultExecuteCommand`** is also exported as a public helper
  (re-exported from the package barrel).
- **`HarnessServer` interface** (`src/server/server.types.ts`) exposes
  `port` and `close()`.

### Session completion reconciliation
- **`extractTurnError` / `reconcileAgentEnd` / `reconcileAgentEndEvent`**
  (`src/server/session-completion.helpers.ts`): the kernel's
  defense-in-depth against engines (notably PI) that hardcode
  `ok: true` on `agent_end` even when the final turn errored. The
  `subscribeForCompletion` helper in `server.execution.ts` tracks the
  most recent `turn_end.output` and, on `agent_end`, replaces a masked
  `ok: true` with a real failure carrying the turn's error and a
  `stopReason: "error"` (unless the engine already reported a different
  stopReason). It also propagates a `suspended: true` directive so the
  executor can park a durable-await run.
- **Tested** by `test/server/session-completion.helpers.test.ts` (5
  cases) and co-located
  `src/server/session-completion.helpers.spec.ts` (3 suspend cases).

### Governance
- **`createCheckPermission(config)`**
  (`src/governance/check-permission-client.ts`): HTTP client that POSTs
  to `${apiBaseUrl}/api/workflow-runtime/check-permission` with the
  agent JWT. 3-attempt retry with linear backoff (500ms × attempt
  index). Maps API response `data.status` to the kernel's
  `PermissionDecision` discriminated union (`allowed` / `denied` /
  `approval_required`). On non-2xx, returns a synthetic `denied`
  decision rather than throwing. On network exhaustion, also returns
  a synthetic `denied` (does not crash the tool run).
- **`wrapToolWithGovernance(tool, checkPermission)`**
  (`src/governance/wrap-tool.ts`): wraps each `CanonicalToolDefinition`
  so every `execute(callId, params, signal)` first consults
  `checkPermission(tool.name, params)`. `denied` returns a structured
  `permission_denied` result without invoking the tool; `allowed` and
  `approval_required` both proceed (the API held `approval_required`
  until cleared, so by the time the decision returns, execution is
  cleared).
- **Tested** by `test/governance/wrap-tool.test.ts` (3 cases covering
  all three decision outcomes).

### WebSocket gateway
- **`createOrchestratorClient(websocketUrl, agentJwt)`**
  (`src/gateway/orchestrator-client.ts`): a socket.io-client wrapper
  with a `CommandRegistry` (handlers / pending / waiters) that buffers
  incoming commands and dispatches to the correct waiter or handler.
  Supports 15 `OrchestratorCommand` types (config + dehydrate / abort /
  prompt / question_response / step_complete_result /
  spawn_subagent_async_result / wait_for_subagents_result /
  check_subagent_status_result / 7 war-room result types). `connect()`
  races a 30s timeout; `waitForCommand` accepts either a numeric
  `timeoutMs` or a `{ timeoutMs, match }` predicate. `disconnect()` is
  idempotent. `onCommand` flushes any queued payload for the
  registration.
- **Direct event routing**: `step_complete_result`,
  `spawn_subagent_async_result`, `wait_for_subagents_result`,
  `check_subagent_status_result` are also received as direct socket
  events (not just nested under the `command` event) for back-compat.
- **Public types** (`src/gateway/orchestrator-client.types.ts`): full
  type-safe payload shapes for all 15 command types + `QuestionAnswer`
  + `WaitForCommandOptions<T>`.

### Tool surface
- **`loadMountedToolDefinitions(extensionsDir, apiContext, runnerLocalHandler?)`**
  (`src/tools/mounted-tools.ts`): reads `*.ts` files in
  `extensionsDir` (excluding `index.ts`), parses `export const metadata
  = {...}` from each, compiles the JSON schema with Ajv (strict:false,
  allErrors:true), and produces a `CanonicalToolDefinition` whose
  `execute` either:
  - dispatches to the injected `runnerLocalHandler` (only used today
    for `ask_user_questions`),
  - calls `executeApiCallback` (Nexus HTTP API with retry, body
    mapping, JWT decoding, undici dispatcher with 1-hour long-poll
    timeouts), or
  - returns a stub success if neither is configured.
  - `ensureResultFits(result, workspacePath, toolName)` writes oversized
    text content (over `TOOL_RESULT_CHAR_THRESHOLD = 32_000` chars) to
    `.nexus/tool-results/<tool>_<timestamp>.json` and replaces the
    content with a 2 000-char preview + a relative path.
  - Validation: `repairKnownApiCallbackParams` (alias `reason`→`reasoning`
    on `step_complete`), `normalizeStringifiedValues` (re-parse
    stringified arrays/objects), AJV schema validator.
  - Logging: skips files with unparseable metadata (warn) and reports
    total loaded tool count.
- **`executeApiCallback` / `buildCallbackBody` /
  `formatApiCallbackResultText`** (`src/tools/api-callback.ts`):
  6-attempt retry (configurable via `NEXUS_API_CALLBACK_MAX_ATTEMPTS`,
  default 6), exponential backoff capped at 8 000ms, retriable on
  HTTP 408/425/429/500/502/503/504. Uses an `undici` `Agent` with
  1-hour header/body timeouts for long-poll compatibility.
  `validateProjectScopedToolParams` short-circuits `kanban.*` tools
  that still carry the literal `project_id === "default"` (means the
  trigger context scope wasn't resolved), returning
  `unresolved_project_id` before any HTTP call. Maps API errors to
  `AgentErrorFeedback` (from `@nexus/core`); honours the response's
  `retryable`, `recommended_action`, and `code` fields.
  `buildApiCallbackSuccessResult` honors the
  `data.executionStatus === "suspended"` directive (sets
  `terminate: true` so the SDK can abort the in-flight turn and park
  for durable resume).
- **`executeExternalMcpCallback`**
  (`src/tools/external-mcp-callback.ts`): JSON-RPC 2.0
  `tools/call` POST to a remote MCP server; mounts caller headers but
  strips runtime-context headers so the agent JWT + x-workflow-run-id
  / x-step-id / x-job-id / x-correlation-id (decoded from the JWT by
  `http-utils.ts:decodeRuntimeContextHeaders`) win.
- **`http-utils.ts`**: shared JWT decoder, JSON-safe parser, response
  normalizer, runtime-context header builder (used by both
  api-callback and external-mcp-callback).
- **`buildToolCatalog`**
  (`src/tools/build-tool-catalog.ts`): adapts
  `CanonicalToolDefinition[]` into `CanonicalToolSpec[]` for
  `permission_callback` engines. Each spec's `invoke(params)` calls
  the underlying `execute(randomUUID(), params)` — the SDK hands
  params-only, so the kernel mints a fresh call id per invocation.
- **`normalizeToolNameKey` / `buildCanonicalToolNameResolver`**
  (`src/tools/tool-name-normalization.ts`): lowercase + collapse
  non-alphanumeric runs to a single underscore + trim leading/trailing
  separators. `buildCanonicalToolNameResolver` indexes a list of
  canonical names by their normalized key and, for names absent from
  the catalog (e.g. SDK built-ins like `Read`/`Bash`), falls back to
  the normalized key. Lets engines recover the dotted
  `kanban.project_state` from the SDK's underscore-sanitized
  `kanban_project_state` before consulting governance.
- **Tests**:
  `src/tools/api-callback.spec.ts` (project-scope guard, suspend
  directive, plain success),
  `src/tools/build-tool-catalog.spec.ts` (empty catalog, field
  mapping, call id uniqueness),
  `src/tools/tool-name-normalization.spec.ts` (lowercase/collapse,
  dotted → underscore recovery, SDK built-in fallback).

### Runner-local: ask_user_questions
- **`buildRunnerLocalHandler(client)`** in `src/kernel.ts`: the only
  runner-local tool today. `ask_user_questions` posts a
  `user_questions_posed` event and waits indefinitely for
  `question_response` via `client.waitForCommand("question_response",
  30 * 60 * 1000)`. **Never fabricates a timeout answer**: when the
  wait window elapses without a response, the loop re-arms and keeps
  waiting. The orchestrator owns the interaction lifecycle (idle
  containers are stopped/removed by the question idle tracker, late
  answers resume the session).
- **Tested** by `src/kernel.spec.ts` (3 cases covering the re-arm
  loop, first-response success, and unsupported-tool fallback).

### Checkpoint
- **`maybeCreateCheckpointWriter(session, opts)`**
  (`src/server/checkpoint-wiring.ts`): returns a started
  `SessionCheckpointWriter` only when `SESSION_CHECKPOINT_PATH` is set
  AND the engine is `pi` or `claude-code` (custom:* engines return
  `undefined` — no checkpoint for third-party engines). For
  `claude-code`, the `getSessionRef` lazily reads
  `session.getProducedSessionId()` and returns
  `{ kind: "claude_code", sessionId }` once the engine has emitted
  one. For `pi`, the `getSessionRef` returns `null` at this layer
  (no `treeId` available — downstream persistence hydrates it from
  the sidecar when replaying).
- **`SessionCheckpointWriter`**
  (`src/checkpoint/session-checkpoint-writer.ts`): subscribes to a
  `HarnessSession` and emits two-phase `SessionCheckpointMarker`s
  (`intent` on `tool_execution_start`, `result` on
  `tool_execution_end`), sharing `callSeq` via a `toolCallId → seq`
  map. The `idempotencyKey` is `sha256("seq:toolName:argsJSON")`. Sink
  errors are caught and warned (don't throw into the engine). `stop()`
  unsubscribes.
- **`FileSidecarSink`**
  (`src/checkpoint/file-sidecar-sink.ts`): appends one JSONL line per
  marker and calls `fsync` after every write so the marker survives a
  subsequent SIGKILL on a reaped container.
- **Tested** by `src/checkpoint/session-checkpoint-writer.spec.ts` (4
  cases — callSeq sharing, monotonic increment, post-stop no-op,
  sink-rejection no-throw),
  `src/checkpoint/file-sidecar-sink.spec.ts` (append + fsync), and
  `src/server/server.checkpoint.spec.ts` (4 cases — disabled when
  path unset, started for `pi`/`claude-code`, `undefined` for
  `custom:*`).

### v3 session JSONL writer
- **`V3SessionWriter`** (`src/session/v3-session-writer.ts`):
  engine-agnostic JSONL writer matching the `pi-coding-agent` "v3"
  shape. `create(sessionPath, cwd, opts)` writes the header line
  (`type: "session"`, `version: 3`, generated id, timestamp, cwd);
  `open(sessionPath, opts)` resumes from the last node so the chain
  continues across container restarts; `appendNode(payload)` assigns
  `id`, `parentId` (chained to the previous node), and `timestamp`,
  then returns the new id. `genId`/`now` are injected so tests can
  use a deterministic counter and a fixed clock.
- **`V3WriterOptions` / `V3NodePayload` types**
  (`src/session/v3-session-writer.types.ts`): `model_change` and
  `message` payload shapes, with the message shapes
  (`user`/`assistant`/`toolResult`) matching the pi session format.
- **Tested** by `test/session/v3-session-writer.test.ts` (4 cases —
  header shape, id/parentId chaining, node invariants, resume from
  the last node).

### Telemetry forwarder
- **`createTelemetryForwarder(client)`**
  (`src/telemetry/forwarder.ts`): thin closure that re-emits each
  `CanonicalSessionEvent` to the orchestrator via
  `client.emit(event.type, event)`. Used in `startKernel` and
  available for engine-level wiring.

### Index barrel
- **`src/index.ts`** re-exports every public surface as a single
  tree-shakeable module: engine types, governance helpers, tool
  loaders, tool callbacks, host-mount utilities, tool-name
  normalization, the orchestrator client + types, the server +
  `executeAgentStep`, config, telemetry forwarder, kernel
  (`registerEngine`/`loadEngine`/`assertTelemetryVersion`/
  `KERNEL_TELEMETRY_VERSION`/`startKernel`), checkpoint
  (`SessionCheckpointWriter`, `FileSidecarSink`, types), and v3
  session writer.

## Health Findings

- **Test coverage** (7 `src/**/*.spec.ts` files + 7 `test/**/*.test.ts`
  files, ~1.3k LOC of tests against ~2.6k LOC of non-spec source):
  - `src/kernel.spec.ts` — runner-local handler wait / re-arm /
    unsupported-tool fallback.
  - `src/server/server.checkpoint.spec.ts` — checkpoint-wiring
    enable/disable + engine-allowlist.
  - `src/server/session-completion.helpers.spec.ts` — suspended
    `agent_end` propagation.
  - `src/checkpoint/session-checkpoint-writer.spec.ts` — callSeq
    sharing, monotonic increment, stop, sink-failure tolerance.
  - `src/checkpoint/file-sidecar-sink.spec.ts` — append + fsync.
  - `src/tools/api-callback.spec.ts` — `project_id === "default"`
    short-circuit, suspend directive, plain success.
  - `src/tools/build-tool-catalog.spec.ts` — empty catalog, field
    mapping, call id uniqueness.
  - `src/tools/tool-name-normalization.spec.ts` — dotted ↔
    underscore, idempotency, SDK built-in fallback.
  - `test/config/config.test.ts` — default + override for
    `extensionsPath` / `sessionPath`.
  - `test/engine/spi-contract.test.ts` — FakeSession/FakeEngine
    canonical-event emission.
  - `test/governance/wrap-tool.test.ts` — allowed/denied/
    approval_required branches.
  - `test/kernel/engine-load.test.ts` — telemetry-version guard
    accept/reject.
  - `test/server/session-completion.helpers.test.ts` — masked
    `agent_end` correction, success passthrough.
  - `test/session/v3-session-writer.test.ts` — header, chaining,
    invariants, resume.
  - `test/tools/host-mount-scope.test.ts` — manifest reader
    (5 cases) + scope guards (10 cases).
- **Conformance coverage** lives in the sibling package
  `packages/harness-conformance/` (C1–C9 matrix, golden v3 JSONL);
  the harness-runtime package itself does not host conformance tests.
- **Build / packaging**: `package.json` declares `tsc -p
  tsconfig.build.json` (strict TypeScript, `module: NodeNext`,
  `target: ES2022`) and `vitest run`. `tsconfig.build.json` excludes
  `*.spec.ts` and `test/` from `dist/`. Vitest config picks up
  `src/**/*.spec.ts` and `test/**/*.test.ts`.
- **Container integration**:
  - `docker/Dockerfile.heavy` and `docker/Dockerfile.light` build
    `@nexus/harness-engine-pi` (and transitively
    `@nexus/harness-runtime`) via `npx turbo run build
    --filter=@nexus/harness-engine-pi`, then copy `dist/` into the
    runtime image. `WEBSOCKET_URL`, `WORKSPACE_PATH`, `HARNESS_ID=pi`
    defaults are set; the entrypoint runs `node
    /app/packages/harness-runtime/dist/main.js` (heavy variant
    symlinks `/app/node_modules` to `/workspace/node_modules` when
    the workspace lacks one).
  - `docker/Dockerfile.claude-code` does the same with
    `@nexus/harness-engine-claude-code`, resolves the Claude CLI
    binary at startup (not build time, so SDK updates don't break
    the path), and sets `HARNESS_ID=claude-code`,
    `DISABLE_AUTOUPDATER=1`.
  - All three images `EXPOSE 8374` matching the kernel's
    `DEFAULT_PORT`.
- **Code quality**:
  - Strict TypeScript throughout; `module: NodeNext`; clean
    barrel pattern via `src/index.ts`; no observed TODOs or
    `console.log`s in the non-test source.
  - Side-effect-driven engine registration is consistent with the
    kernel SPI but, as noted in the `harness-engine-pi` probe,
    means importing the engine package twice in the same process is
    idempotent only because the registry overwrites with a new
    factory.
  - `vitest.config.ts` has a stale alias block: it points
    `@anthropic-ai/claude-agent-sdk` at
    `test/conformance/__mocks__/claude-agent-sdk.ts` and
    `@nexus/harness-engine-claude-code` at
    `../../packages/harness-engine-claude-code/src/index.ts`. The
    `test/conformance/` directory does not exist in this package
    (the conformance suite is in
    `packages/harness-conformance/test/conformance/`). The aliases
    are dead and can be removed without affecting test execution.
- **Dependencies**: `ajv@^8`, `socket.io-client@^4.8`,
  `undici@^7`, `zod@^4`, `@nexus/core` (peer). Dev-only:
  `cross-env`, `typescript@^6`, `vitest@^4.1`.
- **Partial finding — host mount scope guards**: the
  `host-mount-scope` module is fully implemented and has a 345-LOC
  test suite, and is re-exported from `src/index.ts`. However,
  `src/kernel.ts` does not import or call
  `applyHostMountScopeGuards` / `readHostMountScopeManifest`; the
  mounted-tool loader never applies the guards. The
  `host-mount-scope.ts` API is therefore a reusable library, not a
  kernel-enforced behavior, on this revision. The legacy
  `pi-runner` had kernel-level host mount guard enforcement
  (`host-mount-scope.ts` in `packages/pi-runner`); whether the new
  harness runtime is expected to enforce them at the kernel layer
  (vs at the engine layer, where they may be applied to the
  engine's built-in tools like `read`/`write`) is an open design
  question (see Open Questions).
- **Partial finding — dead vitest aliases**: the two vitest aliases
  in `vitest.config.ts` reference a non-existent
  `test/conformance/` directory and a non-runtime package source.
  They should be deleted (or replaced with a small docstring
  pointing at the separate conformance package) to keep the config
  honest.

## Open Questions

- Should `applyHostMountScopeGuards` be wired into
  `loadMountedToolDefinitions` (or applied by the engine package on
  its own `read`/`write` tools) to give the kernel — rather than
  the engine — final say on host mount scope enforcement? The
  legacy `pi-runner` enforced them at the runner layer; the new
  design has the module but the kernel never invokes it. Without
  resolution, the runtime currently relies on the engine to apply
  these guards (or on the deployment to rely on absence of
  host-shares when the engine doesn't).
- The conformance tests for the kernel/engine contract live in
  `packages/harness-conformance/`, not in this package. The kernel
  itself has no integration test that boots a real engine + a mock
  orchestrator; a runtime-level smoke test
  (`test/integration/kernel.boot.test.ts`?) that exercises
  `startKernel` end-to-end would close the last test gap.
- The kernel emits the durable-await `suspended` directive via
  `buildApiCallbackSuccessResult` (reading `data.executionStatus`)
  but does not consult the session-completion reconciler to
  distinguish a "normal end" from a "suspended end" when the engine
  reports a `stopReason: "suspended"`. Currently the
  `suspended: true` flag is set in `buildApiCallbackSuccessResult`
  and the `agent_end` reconciler propagates it; whether the
  orchestrator fully trusts either signal (vs requiring a dedicated
  `suspended` event) is outside this probe's scope.
- The vitest config's two `resolve.alias` entries
  (`@anthropic-ai/claude-agent-sdk` → `test/conformance/__mocks__/`,
  `@nexus/harness-engine-claude-code` →
  `../../packages/harness-engine-claude-code/src/index.ts`) point
  at non-existent paths. They are dead but not breaking; should
  they be removed in a follow-up?
- `startServer` schedules a graceful shutdown via `setTimeout(...,500)`
  rather than awaiting the disconnect, and does not signal an
  in-flight `executeAgentStep` to abort — relying on the engine's
  own `abort()` to be triggered by the `/execute/command` or by a
  separate signal path. Whether `/shutdown` should cancel running
  steps is a design decision worth confirming.
- The kernel's `startKernel` (`src/kernel.ts:92`) creates a
  `createTelemetryForwarder(client)` and discards it
  (`void _forwarder`) — the comment says it is "available for
  future engine-level wiring". Today, telemetry is forwarded per
  session in `executeAgentStep` via `subscribeForCompletion`. The
  forwarder's intended role (engine-level vs step-level) is
  implicit, not documented.
