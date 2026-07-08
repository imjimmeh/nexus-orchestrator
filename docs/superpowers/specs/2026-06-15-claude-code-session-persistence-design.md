# Claude Code Harness — Session Persistence Parity

**Date:** 2026-06-15
**Status:** Approved (design)
**Owner:** Jimmeh

## Context

Workflow runs and chat sessions executed on the **pi** harness persist their full
conversation as a session tree in the `pi_session_trees` table (gzip+base64 JSONL),
which powers the `/sessions` viewer, the session/debug retrieval skills, distillation,
failure-evidence collection, and durable resume.

Runs executed on the **claude-code** harness persist **nothing** to `pi_session_trees`,
and `chat_sessions.harness_id` is never populated. A claude-code workflow run
(`3f01c588-34c2-4c45-b87d-ea65efe39647`) produced events in `event_ledger` but no
`pi_session_trees` row and no `chat_sessions` row, so none of the JSONL-based consumers
work for it.

**Root cause:** pi's session JSONL is written by the third-party
`@earendil-works/pi-coding-agent` `SessionManager`, which wraps SDK events into "v3"
tree nodes on disk at `CONTAINER_SESSION_PATH`. The API's `SessionHydrationService`
extracts that file after the container exits. The claude-code SDK manages its session
internally and writes no such file, so extraction silently no-ops.

Both harnesses already map their native events to the shared `CanonicalSessionEvent`
schema (`packages/core/src/schemas/harness/session-events.schema.ts`) via
`mapPiEventToCanonical` and `ClaudeEventMapper.map`. The only divergence is **how the
canonical stream reaches durable storage.**

## Goal

Make claude-code session persistence **functionally identical** to pi:

- Full canonical transcript persisted as a v3 session tree in `pi_session_trees`,
  linked to its `workflow_run_id` / `chat_session_id`, decodable by `retrieve-session-logs`.
- `chat_sessions.harness_id` populated at creation.
- Reap path persists claude-code sessions on container loss, same as pi.

**Non-goals (explicitly out of scope):**

- Mid-session **branching/forking** emulation for claude-code. Resume stays **linear**
  via `session_id` (already working). The persisted tree is a linear chain.
- Renaming the `pi_session_trees` **table** (broad, risky migration across ~15 files).
  Harness-neutral _method/type_ names are renamed; the table name is retained.
- Changing the `/sessions` web viewer (it renders from the live event stream, not the
  decoded JSONL).

## Chosen approach: Approach A — engine writes canonical v3 JSONL

The claude-code engine produces the **same v3 session JSONL** at `CONTAINER_SESSION_PATH`
that pi produces, so the existing extract → validate → secret-scan → gzip →
`pi_session_trees` pipeline and every downstream consumer work unchanged.

Approaches B (telemetry-buffered API-side sink) and C (read the SDK's native transcript
and map) were rejected: B is a large new stateful component reinventing what the file
gives for free; C couples us to an undocumented SDK-internal file format.

## v3 node format (the compatibility contract)

The persisted JSONL is the **pi-coding-agent SDK's native session format**, validated by
`apps/api/src/session/jsonl-validation.service.ts`:

- `validateJSONL`: every non-empty line must be valid JSON with a truthy `id` and `type`.
- `validateTreeStructure`: each node may reference a parent via `parentId` (v3) or
  `parent` (legacy); every referenced parent id must exist; no cycles.
- `persistSessionFromJsonl` derives `last_leaf_node_id` from the **last** node's `id`.

The format was confirmed empirically by decoding a live pi session tree
(`pi_session_trees.id = f669a97f-ca68-4b5a-befa-88ce82c59a66`, 164 nodes). It is **not**
the `CanonicalSessionEvent` telemetry schema — it is a richer, lossless conversation tree.
Node types and shapes:

```jsonc
// 1. Session header (always first; no parentId)
{ "type": "session", "version": 3, "id": "<uuid>", "timestamp": "<iso>", "cwd": "/workspace" }

// 2. Model declaration (parentId null)
{ "type": "model_change", "id": "<8hex>", "parentId": null, "timestamp": "<iso>",
  "provider": "anthropic", "modelId": "claude-sonnet-4-6" }

// 3. Thinking level (optional)
{ "type": "thinking_level_change", "id": "<8hex>", "parentId": "<prev>", "timestamp": "<iso>",
  "thinkingLevel": "off" }

// 4a. User message
{ "type": "message", "id": "<8hex>", "parentId": "<prev>", "timestamp": "<iso>",
  "message": { "role": "user", "content": [ { "type": "text", "text": "..." } ] } }

// 4b. Assistant message (text + toolCall blocks; carries usage/provider/model/stopReason/responseId)
{ "type": "message", "id": "<8hex>", "parentId": "<prev>", "timestamp": "<iso>",
  "message": { "role": "assistant",
    "content": [ { "type": "text", "text": "<think>...</think>..." },
                 { "type": "toolCall", "id": "<callId>", "name": "<tool>", "arguments": { } } ],
    "api": "...", "provider": "anthropic", "model": "claude-sonnet-4-6",
    "usage": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "totalTokens": 0,
               "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "total": 0 } },
    "stopReason": "toolUse", "timestamp": 0, "responseId": "..." } }

// 4c. Tool result (role is "toolResult", not a content block of the user message)
{ "type": "message", "id": "<8hex>", "parentId": "<prev>", "timestamp": "<iso>",
  "message": { "role": "toolResult", "toolCallId": "<callId>", "toolName": "<tool>",
    "content": [ { "type": "text", "text": "..." } ] } }
```

Rules confirmed from the sample:

- Node `id`s are **8-char hex** (the `session` header id is a full UUID); `parentId` chains
  **linearly** (single chain — claude-code is linear so this matches exactly).
- Content block types observed: `text` and `toolCall`. `toolResult` is a message **role**, not
  a content block.
- The exact field set MUST match what pi writes; this is pinned by golden fixtures derived
  from real pi output (see Testing → golden conformance), not guessed.

### Mapping source: Claude SDK messages, not canonical events

Because the v3 format mirrors a full message/tool/usage structure, the faithful source is the
**Claude Agent SDK messages** (`assistant` / `user` / `result`, already role+content-block shaped
with usage), which `ClaudeEventMapper` already consumes — **not** the lossy `CanonicalSessionEvent`
telemetry stream. The Anthropic→v3 transforms required:

- assistant `text` block → v3 `text` content block (preserve as-is; pi inlines thinking as text).
- assistant `tool_use` block → v3 `toolCall` block (`{ id, name, arguments }`).
- user `tool_result` block → a v3 `toolResult`-role message node.
- Anthropic `usage` (`input_tokens` / `output_tokens` / `cache_creation_input_tokens` /
  `cache_read_input_tokens`) → v3 `usage` (`input` / `output` / `cacheWrite` / `cacheRead`,
  `totalTokens`, `cost` zeroed — cost is computed elsewhere).

## Components & changes

Two units with a clean split: a **generic v3 writer** (shared, engine-agnostic file/tree
mechanics) and a **Claude→v3 mapper** (engine-specific translation). The claude-code engine
package takes **no** dependency on the pi SDK.

### 1. `V3SessionWriter` (new, shared — `packages/harness-runtime/src`)

- Responsibility: the generic mechanics of writing a v3 session JSONL file — emit the
  `session` header, append nodes one-per-line, generate 8-char-hex node ids, chain `parentId`
  linearly, and support resume continuation. It accepts already-shaped **v3 node payloads**;
  it knows nothing about Claude or canonical events.
- API:
  - `static create(sessionPath: string, opts: { cwd: string; uuid: () => string; now: () => string }): V3SessionWriter`
    — writes a fresh `session` header line.
  - `static open(sessionPath: string, opts): V3SessionWriter` — reads the existing file,
    seeds the parent pointer from the **last** node's `id` (resume continuation).
  - `appendNode(node: V3NodePayload): string` — assigns `id`/`parentId`/`timestamp`, appends
    one JSON line, returns the new node id. `V3NodePayload` is the per-type body
    (`model_change` | `message`), minus the id/parentId/timestamp the writer owns.
- Determinism: `uuid` and `now` are injected so the golden test is byte-stable.
- Single purpose; no engine coupling → reusable by any future engine.

### 2. `mapClaudeMessageToV3Nodes` (new — `packages/harness-engine-claude-code/src`)

- Responsibility: pure function translating one Claude Agent SDK message
  (`assistant` / `user` / `result`) into zero or more `V3NodePayload`s per the transforms in
  "Mapping source" above (tool_use→toolCall, tool_result→toolResult node, usage remap).
- Pure and deterministic (no ids/timestamps — those belong to the writer), so it is unit-tested
  in isolation.

### 3. Wire writer + mapper into the claude-code engine

- Files: `packages/harness-engine-claude-code/src/claude-code-engine.ts`,
  `claude-code-session.ts`.
- Mirror pi's `buildSessionManager`: choose `V3SessionWriter.open` (resume, when
  `ctx.sessionPath` exists) vs `.create`. On the first node, emit a `model_change` from the
  resolved provider/model. As `ClaudeCodeSession.consume` reads each SDK message, run it
  through `mapClaudeMessageToV3Nodes` and `appendNode` each result — alongside the existing
  canonical-event forwarding (telemetry is untouched).
- Resume: `.open` seeds the parent from the last node so the linear chain continues.
- Failure isolation: writer errors are caught and logged; they MUST NOT abort the agent run.

### 4. Populate `chat_sessions.harness_id`

- Files: `apps/api/src/chat/chat-sessions/chat-sessions.mappers.ts`
  (`buildChatSessionCreatePayload`) and the chat-execution dispatch that resolves the harness.
- Resolve the harness id at chat-session creation (chat-execution currently does not call
  `resolveRunnerHarness`) and thread it into the create payload. Executions already persist
  `harness_id`; reuse that resolution result where available to stay DRY.

### 5. Generalize the reap path

- File: `apps/api/src/execution-lifecycle/execution-supervisor.service.ts`.
- The `if (marker.engine === 'pi')` branch becomes engine-agnostic: persist host-side
  session JSONL for `pi` **and** `claude-code`.
- Rename `persistPiSessionFromHost` → a harness-neutral name (e.g.
  `persistHarnessSessionFromHost`); return `{ kind: marker.engine, treeId }`.
- No new read logic needed: claude-code now writes the same sidecar JSONL.

### 6. No mount/env changes

Both harnesses already receive `SESSION_PATH=CONTAINER_SESSION_PATH` and `HARNESS_ID`
(`step-agent-container-config.helpers.ts`, `chat-execution/container-config-builder.service.ts`).

## Error handling

- Writer append failures: caught, logged, run continues (best-effort persistence).
- Extraction failures / missing or empty session file: already handled by
  `SessionHydrationService` and the reap path (return `null`), unchanged.
- Secret scanning: applied by the existing `persistSessionFromJsonl` pipeline — claude-code
  JSONL passes through the same redaction with no special handling.
- Invalid JSONL / broken tree: surfaced by existing `JSONLValidationService` (fails fast
  with a descriptive `BadRequestException`).

## Testing (TDD, red→green→refactor)

- **Unit — mapper:** `mapClaudeMessageToV3Nodes` for each SDK message kind (assistant with
  text+tool_use, user with tool_result, result), including the usage remap.
- **Unit — writer:** `V3SessionWriter` emits the `session` header; `appendNode` assigns
  8-hex ids and chains `parentId` linearly; `open` resume continuation seeds parent from the
  last node; output passes `JSONLValidationService`.
- **Golden conformance:** add claude-code to `packages/harness-conformance` with a golden
  session-JSONL test. Golden fixtures are derived from real pi output so both engines are
  provably format-identical. This is the guarantee of "functionally identical."
- **Unit — chat session:** `harness_id` is populated by `buildChatSessionCreatePayload`
  / the dispatch path.
- **Unit — reap:** the generalized branch persists a claude-code session and records the
  checkpoint with `{ kind: 'claude_code', treeId }`.
- **Integration:** a claude-code run yields a `pi_session_trees` row that decodes via the
  same gunzip/base64 path `retrieve-session-logs` uses.

## Consumers verified unchanged

`SessionHydrationService`, `pi-session-tree.repository`, `retrieve-session-logs`,
distillation consumer, `workflow-failure-evidence.collector`, subagent-parent-resume —
all read the v3 JSONL / `pi_session_trees` and require no changes once claude-code
produces compatible output.

## Risks

- **v3 schema drift:** the golden fixtures pin the exact format; if the pi SDK changes its
  node schema, the conformance test catches the divergence for both engines.
- **Resume parent seeding:** opening a partial file and continuing the chain must not
  duplicate or orphan nodes — covered by the resume-continuation unit test.

## Rollout

Single feature branch implemented in a git worktree, then merged to `main`. No data
migration. Existing pi runs are unaffected (shared writer is additive; pi continues to
use its SDK `SessionManager`).
