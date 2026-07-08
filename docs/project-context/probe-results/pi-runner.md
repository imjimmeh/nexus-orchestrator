---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: pi-runner
outcome: success
inferred_status: implemented
confidence_score: 0.85
evidence_refs:
  - packages/pi-runner/src/main.ts
  - packages/pi-runner/src/server/server.ts
  - packages/pi-runner/src/session/session-factory.ts
  - packages/pi-runner/src/gateway/orchestrator-client.ts
  - packages/pi-runner/src/browser/browser-handlers.ts
  - packages/pi-runner/src/telemetry/telemetry-bridge.ts
  - packages/pi-runner/src/tools/nexus-bridge-tools.ts
source_paths:
  - packages/pi-runner/src
updated_at: 2026-05-22T00:00:00.000Z
---

# Probe Result: Pi Runner Runtime Bridge

## Narrative Summary

Pi Runner is a long-lived execution plane that bridges the Nexus orchestrator to the coding-agent SDK. It operates as an HTTP server accepting step execution requests, managing browser automation sessions via Playwright, loading mounted tool extensions, wrapping all tool calls with API-side governance checks, and streaming telemetry events back to the gateway via WebSocket. The codebase is well-structured with 12 test files covering core modules including config validation, WebSocket command handling, host mount scope guards, API callbacks with external MCP support, telemetry bridging, and user question blocking. All major capabilities are implemented and tested.

## Capability Updates

- **HTTP Server Mode**: Long-lived server (`server.ts`) replacing the old "run-once" model, exposing `/health`, `/execute/agent`, `/execute/command`, and `/shutdown` endpoints. Supports background agent execution (returns immediately while agent runs async).
- **Browser Automation Runtime**: Playwright-based session manager (`browser-runtime.manager.ts`) handling Chromium lifecycle, with action handlers (`browser-handlers.ts`) supporting `open_page`, `navigate`, `click`, `type`, `wait_for`, `read_page`, `screenshot`, and `close_page`. Includes selector strategy resolution with aliases, heuristics (test-id, role+name, text, placeholder), and configurable retry/backoff policies.
- **WebSocket Gateway**: Socket.io-based orchestrator client (`orchestrator-client.ts`) with command registry, buffering, waiter pattern, and config caching. Supports 15+ command types including `dehydrate`, `abort`, `prompt`, `question_response`, war-room commands, and subagent async results.
- **Session Factory**: Creates configured `AgentSession` wiring AuthStorage, ModelRegistry, SessionManager, SettingsManager, and DefaultResourceLoader. Applies governance wrappers to all tools (SDK and mounted) before passing to the session. Reads mounted tool definitions from extension directory and loads SDK tool allowlist.
- **Governance Wrapping**: Every tool call (including SDK built-ins like `bash`, `write`) is gated through `/workflow-runtime/check-permission` API with 3-retry network resilience. Can be disabled via `NEXUS_RUNNER_DISABLE_GOVERNANCE_CHECK`.
- **API Callbacks**: Execute HTTP calls to Nexus API with retry logic (3 attempts for retriable status codes), body mapping, JSON parsing of stringified params, and `project_id` injection from JWT.
- **External MCP Support**: Direct JSON-RPC 2.0 calls to external MCP servers via mounted tool metadata, with header injection for runtime context (workflow-run-id, step-id, job-id).
- **Host Mount Scopes**: Guard system (`host-mount-scope.ts`) restricting read/write access to container paths under `/workspace/host-shares`. Applies to `read`, `ls`, `find`, `grep`, `write`. Denies recursive traversal of host shares via `find`/`grep`.
- **Read Fallback**: Wraps the `read` tool to gracefully handle EISDIR by delegating to `ls` or building a local directory listing.
- **Telemetry Bridge**: Maps coding-agent session events (`turn_start`, `message_update`, `tool_execution_*`, `turn_end`, `agent_end`) to WebSocket telemetry events consumed by the Nexus gateway.
- **Nexus Bridge Tools**: Provides `ask_user_questions` tool that emits `user_questions_posed` and blocks (up to 30 min) waiting for `question_response` command.
- **Feature Flags**: Environment-based toggles for logging active tool names and read directory fallback events.

## Health Findings

- **Test Coverage**: 12 spec files across the codebase:
  - `config.spec.ts` (env var validation)
  - `orchestrator-client.spec.ts` (WebSocket client with mocked socket.io)
  - `server.spec.ts` (HTTP server background execution)
  - `session-factory.spec.ts` (host mount scope guards)
  - `session-factory.tools.spec.ts` (mounted tool loading, API callbacks, external MCP)
  - `api-callback.spec.ts` (project_id injection, markdown content, external MCP)
  - `host-mount-guards.spec.ts` (read/write scope enforcement)
  - `read-fallback.spec.ts` (EISDIR fallback to ls)
  - `telemetry-bridge.spec.ts` (event mapping and finished promise)
  - `nexus-bridge-tools.spec.ts` (tool registration)
  - `ask-user-questions.spec.ts` (blocking, timeout, validation)
  - `tool-builder.spec.ts` (Zod validation, schema stripping)
- **Code Quality**: Clean modular design with barrel exports (`index.ts`) per module. TypeScript interfaces for all public types. Error handling with typed result objects.
- **Minor Gaps**: No direct spec for `browser-handlers.ts` (helpers tested indirectly), no spec for `mounted-tools.ts` beyond the integration tests in `session-factory.tools.spec.ts`.

## Open Questions

- The `NEXUS_RUNNER_LOG_ACTIVE_TOOL_NAMES` feature flag outputs JSON to stdout — is this consumed by any downstream log aggregation?
- The `orchestrator/` subdirectory under `tools/` is referenced in the glob but `index.ts` does not exist — what tools are planned there?
- Browser automation uses `playwright-core` but does not specify which Chromium channel/binary is expected in the container — is this configured at container build time?