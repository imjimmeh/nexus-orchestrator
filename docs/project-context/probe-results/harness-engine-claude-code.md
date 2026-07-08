---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: harness-engine-claude-code
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - packages/harness-engine-claude-code/src/index.ts
  - packages/harness-engine-claude-code/src/claude-code-engine.ts
  - packages/harness-engine-claude-code/src/claude-code-session.ts
  - packages/harness-engine-claude-code/src/claude-code-session.types.ts
  - packages/harness-engine-claude-code/src/map-claude-event.ts
  - packages/harness-engine-claude-code/src/map-claude-message-to-v3.ts
  - packages/harness-engine-claude-code/src/govern.ts
  - packages/harness-engine-claude-code/src/mcp-server.ts
  - packages/harness-engine-claude-code/src/to-sdk-tool.ts
  - packages/harness-engine-claude-code/src/to-sdk-tool.types.ts
  - packages/harness-engine-claude-code/src/json-schema-to-zod.ts
  - packages/harness-engine-claude-code/src/claude-code-auth-delivery.ts
  - packages/harness-engine-claude-code/src/claude-code-auth-delivery.types.ts
  - packages/harness-engine-claude-code/src/claude-code-auth-env.ts
source_paths:
  - packages/harness-engine-claude-code/src
updated_at: 2026-06-15T00:00:00.000Z
---

# Probe Result: Harness Engine - Claude Code

## Narrative Summary

The `@nexus/harness-engine-claude-code` package implements the Claude Code harness engine that integrates the Anthropic Claude Agent SDK with the Nexus orchestrator runtime. The engine exposes a `ClaudeCodeEngine` class registered under the id `"claude-code"` that constructs `ClaudeCodeSession` instances, dynamically loads the `@anthropic-ai/claude-agent-sdk` (with graceful fallback to a stub session when the SDK is not installed), and wires the SDK `query()` call with the Nexus tool catalog, governance, auth, v3 JSONL persistence, MCP server, and resume semantics.

The implementation is mature and feature-complete: it handles durable agent-await suspend (via `executionStatus:suspended` → `terminate:true` → `onTerminate` → abort), maps Anthropic SDK stream messages to both canonical session events and pi-compatible v3 node payloads, normalizes tool names (MCP prefix stripping, dot↔underscore recovery, lowercasing runner-native tools), and supports both API-key and OAuth auth delivery modes (env var or native `~/.claude/.credentials.json` file). Comments throughout the source code cite specific kanban tickets (e.g., kanban-u4la, kanban-miiu, kanban-atuq, kanban-nm7q, kanban-an5f), indicating deliberate design tradeoffs were captured in writing.

## Capability Updates

- **HarnessEngine implementation**: `ClaudeCodeEngine` implements the `HarnessEngine` interface from `@nexus/harness-runtime`, declaring `id = "claude-code"` and advertising `CLAUDE_CODE_CAPABILITIES`. `validate()` enforces that `model.provider` is present.
- **Dynamic SDK import with stub fallback**: `createSession()` dynamically `await import("@anthropic-ai/claude-agent-sdk")` and falls back to a stub `AsyncIterable` that immediately yields an `error` result when the SDK is not installed, so the engine still satisfies the runtime contract in dev environments.
- **MCP server wiring**: Constructs an in-process SDK MCP server (`nexus-kernel-tools`) that exposes the entire `toolCatalog` as SDK tools. The MCP entry is passed verbatim to `mcpServers` (no double-wrap) — the comment explicitly notes that re-wrapping breaks `instance.connect(transport)`.
- **Governance gate via `canUseTool`**: `buildCanUseTool` in `govern.ts` converts Nexus `PermissionDecision` to the SDK's `PermissionResult` shape — `allow` carries `updatedInput` (required by SDK runtime schema even though `.d.ts` marks it optional), `deny` carries `message`. `approval_required` is treated as allow for parity with the pi harness.
- **Tool-name normalization**: `buildCanonicalToolNameResolver` (from harness-runtime) plus `stripNexusMcpPrefix` ensure the governance registry sees canonical names (e.g., `kanban.project_state`, lowercase `bash`) regardless of whether the SDK presents them as `mcp__nexus-kernel-tools__kanban_project_state` or PascalCase `Bash`.
- **JSON Schema → Zod conversion**: `jsonSchemaToZod` translates mounted tools' JSON Schema parameters into Zod schemas (required by the SDK's `tool()` constructor). Uses `z.looseObject` so unknown keys are preserved (caller-side validation is still authoritative), maps `anyOf`/`oneOf`/`enum`/`type` array unions, and falls back to `z.any()` for unrecognized constructs.
- **Auth delivery**: `buildClaudeAuthDelivery` returns either an env map (default `CLAUDE_CODE_OAUTH_TOKEN` for OAuth, `ANTHROPIC_API_KEY` for API key) or, when `CLAUDE_CODE_AUTH_DELIVERY=file`, a `ClaudeCredentialsFile` blob matching the native `claude login` output (so the CLI authenticates as an interactive session). The engine writes the file with mode `0600` if requested.
- **v3 JSONL persistence**: `buildV3Persistence` opens an existing session file (resume) or creates a fresh one seeded with a `model_change` node, using `V3SessionWriter` from harness-runtime. The `ClaudeV3Mapper` translates SDK messages into pi-compatible v3 nodes (assistant message, toolResult nodes, inline `<think>` blocks for thinking). Persistence is best-effort — failures never block the turn.
- **Session lifecycle**: `ClaudeCodeSession` captures the SDK-assigned `session_id` from `system`/`init`/`result` messages, surfaces it via `getProducedSessionId()` for resume. `prompt()` is a no-op (the turn is already driven by `query()` at `createSession`) — comments cite kanban-miiu to explain why rejecting here would abort the in-flight turn. `suspend()` plus `abortController.abort()` implements durable agent-await; the session emits a clean suspended `agent_end` (ok:true, stopReason:"suspended") instead of a failed end.
- **Resume support**: When `config.session.resume.kind === "claude_code"`, the engine passes `options.resume = resumeSessionId` to the SDK. Other resume kinds (e.g., `pi`) are ignored. Follow-up `prompt()` calls are permitted only on a resumed session.
- **Environment merging**: The SDK replaces (not merges) the subprocess environment, so the engine spreads `...process.env` into `options.env` to keep PATH/HOME available to the agent's Bash tool (kanban-nm7q).
- **Engine registry self-registration**: `registerEngine("claude-code", () => new ClaudeCodeEngine())` at module-load time wires the engine into the harness-runtime registry.

## Health Findings

- **Test coverage is broad**: 11 spec/test files across both `src/__tests__/` (co-located engine specs) and `test/` (cross-cutting integration tests):
  - `src/__tests__/claude-code-engine.mcp.spec.ts` — verifies MCP server is not double-wrapped; regression guard for `instance.connect` (kanban-u4la).
  - `src/__tests__/claude-code-engine.resume.spec.ts` — exercises resume, fresh-session, non-claude_code resume ref, prompt no-op, and produced sessionId surfacing.
  - `src/__tests__/claude-code-engine.tools-env.spec.ts` — tool catalog registration, Zod schema conversion, env merge (PATH survival), auth env delivery, and tool-name normalization (prefix strip, dotted↔underscore, PascalCase lowercasing).
  - `src/__tests__/normalize-tool-name.spec.ts` — `stripNexusMcpPrefix` unit tests.
  - `src/claude-code-session.spec.ts` — suspend produces ok:true agent_end; unsuspended abort produces ok:false agent_end.
  - `src/json-schema-to-zod.spec.ts` — primitive/array/enum/anyOf/loose-object mapping, required-field enforcement, fallback to `z.any()`.
  - `src/to-sdk-tool.spec.ts` — `isError` flag, `onTerminate` invocation, normal-result path.
  - `test/claude-code-auth-delivery.test.ts` — env vs file mode, API-key fallback, undefined-auth fallback.
  - `test/claude-code-auth-env.test.ts` — api_key↔ANTHROPIC_API_KEY, oauth↔CLAUDE_CODE_OAUTH_TOKEN, empty-key handling.
  - `test/claude-code-session.v3-sink.test.ts` — sink append per mapped message, best-effort persistence on disk-full.
  - `test/govern.test.ts` — allow/deny/approval_required mappings.
  - `test/map-claude-event.test.ts` — tool_use→tool_execution_start, tool_result→tool_execution_end, result→agent_end, turn_start gating.
  - `test/map-claude-message-to-v3.test.ts` — text+tool_use composition, thinking→inline <think>, toolResult with cached name, user text, result→no nodes.
  - `test/to-sdk-tool.test.ts` — invocation forwarding.
- **Build config**: `tsconfig.json` targets ES2022 with `module: NodeNext`, strict mode on. `tsconfig.build.json` excludes test files from the published `dist/`. `vitest.config.ts` runs both `src/**/*.spec.ts` and `test/**/*.test.ts`.
- **Code quality**: Comments are dense and intentional — they document kanban ticket references, SDK quirk workarounds (e.g., the MCP `instance.connect` contract, the env-replace-not-merge behavior), and design tradeoffs (e.g., why `prompt()` is a no-op). No dead code or stub-only modules observed. All public exports in `index.ts` map 1:1 to implemented modules.
- **No churn signal observed**: Single coherent implementation per concern; no TODO/FIXME placeholders or commented-out blocks surfaced.

## Open Questions

- The probe did not exercise runtime behavior against a real `@anthropic-ai/claude-agent-sdk` install — all tests stub the SDK via `vi.mock`. Whether the chosen SDK option names (`mcpServers`, `canUseTool`, `pathToClaudeCodeExecutable`, `env`, `resume`, `abortController`) remain stable across SDK versions is a live contract risk that only integration testing can confirm.
- The `prompt()` no-op contract relies on a comment citing kanban-miiu but the full ticket context (why the server sends a kickoff prompt for an engine that drives the turn itself) is not visible in this scope.
- The kanban ticket references (u4la, miiu, atuq, nm7q, an5f) embedded in source comments imply a parent workflow that drives the design — cross-referencing those tickets would clarify the full set of constraints the engine was built to satisfy, but that context lives outside this scope.
