# EPIC-105: ACP Server Integration (ACP → Nexus)

Status: Proposed
Priority: P2
Depends On: EPIC-104 (ACP Client), EPIC-063 (Ad-hoc Sessions), EPIC-064 (Chat Sessions)
Related:
1. docs/epics/EPIC-104-acp-client-integration.md
2. docs/architecture/chat-sessions.md
3. apps/api/src/chat/ (session engine)
4. https://agentcommunicationprotocol.dev/spec/openapi.yaml
   Last Updated: 2026-04-15

---

## 1. Summary

Expose Nexus agents through the Agent Communication Protocol so external software can discover and invoke them. This makes Nexus an ACP server, enabling interoperability with any ACP-compliant client or agent framework.

---

## 2. Problem

Nexus agents can only be invoked through the internal REST API and WebSocket telemetry layer. External systems have no standardized way to:

1. Discover which Nexus agents exist and what they can do.
2. Invoke agents through a standard protocol.
3. Maintain stateful sessions with agents.
4. Receive streaming output from agents.

Without ACP server support, every external integration requires custom adapter code.

---

## 3. Goals

1. Implement full ACP OpenAPI spec (v0.2.0) as a REST surface on Nexus.
2. Map Nexus agent profiles to ACP AgentManifest for discovery.
3. Support sync, async, and stream run modes.
4. Bridge ACP await/resume to the existing `ask_user_questions` tool flow.
5. Map ACP sessions to Nexus chat sessions for stateful conversations.
6. Provide API key and Bearer token authentication.

## 4. Non-Goals

1. Distributed session storage across multiple Nexus instances (future).
2. Full A2A protocol support (future consideration as spec matures).
3. Resource server pattern for large message content (initial version uses inline content only).

---

## 5. Architecture

### 5.1 Overview

Nexus will host an ACP-compliant REST endpoint that maps external ACP requests to internal agent execution:

```
External Client → /acp REST API → ACP Server Service → Workflow/Session Engine → Agent Container → Response
```

The ACP server module is separate from the outgoing ACP client module (EPIC-104) and operates at `apps/api/src/acp-server/`.

### 5.2 ACP Server Module

**File**: `apps/api/src/acp-server/acp-server.module.ts`

New NestJS module providing:
- ACP REST controllers (public-facing, mounted at `/acp` prefix)
- Agent manifest resolution
- Run lifecycle management
- Session mapping
- Auth adapter (ACP auth → Nexus auth)

### 5.3 ACP REST Controller

**File**: `apps/api/src/acp-server/acp.controller.ts`

Implements full ACP OpenAPI spec:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/acp/ping` | Health check |
| GET | `/acp/agents` | List discoverable Nexus agents |
| GET | `/acp/agents/{name}` | Get agent manifest |
| POST | `/acp/runs` | Create and start a run |
| GET | `/acp/runs/{run_id}` | Get run status |
| POST | `/acp/runs/{run_id}` | Resume an awaiting run |
| POST | `/acp/runs/{run_id}/cancel` | Cancel a run |
| GET | `/acp/runs/{run_id}/events` | List run events (SSE support) |
| GET | `/acp/session/{session_id}` | Get session details |

Endpoints are mounted at `/acp` by default, configurable via `ACP_SERVER_BASE_PATH` env var. This keeps ACP concerns isolated from the internal `/api` routes.

### 5.4 Agent Manifest Mapping

**File**: `apps/api/src/acp-server/acp-manifest.service.ts`

Map Nexus agent profiles to ACP AgentManifest:

| ACP Field | Source |
|-----------|--------|
| `name` | Agent profile name (normalized to RFC 1123 DNS label: lowercase, hyphens) |
| `description` | Agent profile description or system prompt excerpt |
| `input_content_types` | Configurable per agent; default `["text/plain"]` |
| `output_content_types` | Configurable per agent; default `["text/plain"]` |
| `metadata.capabilities` | Derived from assigned skills and allowed tools |
| `metadata.tags` | Derived from agent tier and role |
| `metadata.documentation` | From agent's PROMPT.md |
| `status` | Computed from runtime metrics |

Add `acp_expose` boolean column to `agent_profiles` table to control which agents are externally discoverable. Add `acp_config` jsonb column for per-agent ACP metadata overrides.

### 5.5 Run Lifecycle Bridge

**File**: `apps/api/src/acp-server/acp-run.service.ts`

Map ACP run lifecycle to Nexus execution:

| ACP State | Nexus Mapping |
|-----------|---------------|
| `created` | ACP run record created, Nexus execution not yet started |
| `in-progress` | Workflow run or ad-hoc session executing |
| `awaiting` | Agent called `ask_user_questions` → map to ACP await/resume |
| `completed` | Agent finished, output captured |
| `failed` | Agent errored or timed out |
| `cancelling` | Cancel requested, sending abort to container |
| `cancelled` | Container aborted, run cleaned up |

**New table**: `acp_runs`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | ACP run ID |
| agent_name | varchar(63) | ACP agent name |
| session_id | uuid nullable | ACP session ID |
| nexus_run_ref | varchar nullable | Reference to Nexus workflow run or session |
| status | enum AcpRunStatus | Current state |
| mode | enum AcpRunMode | sync/async/stream |
| input | jsonb | Original input messages |
| output | jsonb nullable | Response messages |
| await_request | jsonb nullable | Await payload if awaiting |
| error | jsonb nullable | Error details |
| created_at | timestamptz | |
| finished_at | timestamptz nullable | |

**New table**: `acp_sessions`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | ACP session ID |
| nexus_session_ref | varchar nullable | Reference to Nexus chat session |
| history_urls | jsonb | Array of message URLs |
| state_url | text nullable | State URL reference |
| created_at | timestamptz | |

### 5.6 Run Execution Strategies

Two execution strategies for ACP runs:

**Strategy A: Ad-hoc Session** (lightweight, for simple agents)
- Create a Nexus chat session with the specified agent profile
- Send input as the first user message
- Map turn results to ACP output messages
- Suitable for stateless or conversational agents

**Strategy B: Workflow Run** (structured, for workflow-driven agents)
- Create a workflow run with an execution step targeting the agent
- Map workflow run state to ACP run state
- More overhead but supports the full pipeline (pre-conditions, output capture, etc.)

Default: Strategy A for `friendly-general-assistant` (light tier), Strategy B for heavy-tier agents. Configurable per agent via `acp_config.execution_strategy`.

### 5.7 Awaiting State Handling

When a Nexus agent calls `ask_user_questions`, the ACP run transitions to `awaiting` state:

1. Capture the question payload as `await_request` on the ACP run
2. The external client sees `status: "awaiting"` with the `await_request` describing what's needed
3. Client sends `POST /runs/{run_id}` with `await_resume` data
4. ACP server injects the resume data as the question response back to the agent
5. Agent continues, run returns to `in-progress`

This maps naturally to the existing `ask_user_questions` tool flow, replacing the WebSocket-based human response channel with the ACP resume mechanism.

### 5.8 Streaming Support

For `mode: "stream"`, the `POST /runs` endpoint returns `text/event-stream`:

- Emit `message.created` events as the agent starts producing output
- Emit `message.part` events for each message part
- Emit `message.completed` events when a full message is assembled
- Emit `run.in-progress`, `run.completed`, etc. for state transitions

This maps to the existing WebSocket telemetry events from pi-runner (`turn_start`, `turn_end`, `agent_telemetry`, `bash_output`).

### 5.9 Authentication & Authorization

**File**: `apps/api/src/acp-server/acp-auth.guard.ts`

ACP supports standard HTTP auth patterns:
- **API Key**: `X-API-Key` header → map to Nexus service account
- **Bearer Token**: `Authorization: Bearer <token>` → validate as Nexus JWT
- **No Auth**: Optional public mode for development (configurable via `ACP_SERVER_ALLOW_PUBLIC`)

**New table**: `acp_api_keys`

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | varchar(120) | Human-readable key name |
| key_hash | text | SHA-256 hash of the API key |
| scopes | jsonb | Permission scopes (e.g., `["agents:read", "runs:write"]`) |
| agent_allowlist | jsonb nullable | Restrict to specific agent names; null = all exposed agents |
| created_by | uuid nullable | User who created the key |
| created_at | timestamptz | |
| expires_at | timestamptz nullable | Optional expiration |

### 5.10 Agent Exposure Configuration

Add to `agent_profiles` table:
- `acp_expose` boolean default false — whether this agent is visible via ACP
- `acp_config` jsonb nullable — per-agent ACP overrides:
  ```json
  {
    "execution_strategy": "session" | "workflow",
    "default_run_mode": "sync" | "async" | "stream",
    "input_content_types": ["text/plain"],
    "output_content_types": ["text/plain", "application/json"],
    "custom_description": "...",
    "max_concurrent_runs": 5,
    "timeout_seconds": 300
  }
  ```

### 5.11 Session Management

ACP sessions map to Nexus chat sessions:
- Creating a run with `session_id` reuses an existing Nexus session
- Creating a run without `session_id` creates a new Nexus session
- Session history maps to ACP message history
- ACP session state maps to Nexus session memory/context

### 5.12 Observability

Extend existing observability:
- `acp_server_request_total` counter by method/status
- `acp_server_request_duration_seconds` histogram
- `acp_server_active_runs` gauge
- Event ledger events: `acp.run.created`, `acp.run.completed`, `acp.run.failed`

---

## 6. Workstreams & Backlog

| ID | Task | Estimate |
|----|------|----------|
| E105-001 | ACP server types (shared with EPIC-104 types where possible) | S |
| E105-002 | Database entities: `acp_runs`, `acp_sessions`, `acp_api_keys`, migration | M |
| E105-003 | Agent profile ACP config columns and migration | S |
| E105-004 | ACP REST controller (all endpoints) | L |
| E105-005 | Agent manifest service (profile → ACP manifest mapping) | M |
| E105-006 | Run lifecycle service (ACP run state machine) | L |
| E105-007 | Awaiting state bridge (ACP await ↔ Nexus ask_user_questions) | M |
| E105-008 | Streaming support (SSE event bridge from telemetry) | M |
| E105-009 | Auth guard (API key, Bearer token, public mode) | M |
| E105-010 | Session mapping (ACP session ↔ Nexus chat session) | M |
| E105-011 | Execution strategy dispatcher (session vs workflow) | M |
| E105-012 | Observability (metrics, events) | S |
| E105-013 | Configuration (env vars, agent-level config) | S |
| E105-014 | Integration tests (all endpoints, lifecycle, auth) | L |
| E105-015 | Architecture documentation | S |

---

## 7. Implementation Order — Estimated 4-5 weeks (starts after EPIC-104 is stable)

1. **E105-001**: Shared types extension (0.5 days)
2. **E105-002 + E105-003**: Database entities and migrations (1-2 days)
3. **E105-009**: Auth guard (2 days)
4. **E105-005**: Agent manifest service (1-2 days)
5. **E105-004**: ACP REST controller (3-4 days)
6. **E105-006**: Run lifecycle service (3-4 days)
7. **E105-007**: Awaiting state bridge (2 days)
8. **E105-008**: Streaming support (2-3 days)
9. **E105-010 + E105-011**: Session mapping + execution strategy (2-3 days)
10. **E105-012 + E105-013**: Observability + configuration (1 day)
11. **E105-014**: Integration tests (3-4 days)
12. **E105-015**: Architecture docs (0.5 days)

---

## 8. Acceptance Criteria

1. External ACP clients can call `GET /acp/ping` and receive a valid response
2. External ACP clients can discover exposed Nexus agents via `GET /acp/agents`
3. External ACP clients can invoke agents via `POST /acp/runs` in sync, async, and stream modes
4. Run lifecycle correctly transitions through all ACP states
5. Awaiting state is correctly mapped: agent questions → ACP await, ACP resume → agent response
6. Sessions enable stateful multi-turn conversations
7. Only agents with `acp_expose=true` are discoverable
8. API key and Bearer token auth are supported
9. Streaming delivers events via SSE as the agent processes

---

## 9. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Agent execution is container-based with startup latency | Pre-warm pools; async/stream modes handle long runs |
| Awaiting state timeout mismatch (ACP timeout vs container timeout) | Configurable timeouts per agent; container keep-alive adjustments |
| Streaming requires bridging WebSocket telemetry to SSE | Build a telemetry-to-SSE adapter service; leverage existing Redis streams |
| Concurrent run limits for agent capacity | Per-agent `max_concurrent_runs` config; queue with backpressure |
| Auth model mismatch (ACP API keys vs Nexus JWT) | Dedicated ACP auth layer with separate key management |
| Container cost for short ACP interactions | Light-tier agents on fast containers; consider session reuse for rapid calls |

---

## 10. Design Decisions

1. **Separate `/acp` mount point**: Keeps ACP concerns isolated from internal `/api` routes, aligns with ACP spec conventions. Configurable via `ACP_SERVER_BASE_PATH` env var.

2. **Ad-hoc sessions as default execution strategy**: Start with session-based execution for simplicity. Workflow-based execution can be added as an opt-in per-agent configuration. Light-tier agents use sessions; heavy-tier agents can opt into workflow execution.

3. **API key auth as primary external auth method**: ACP clients are typically service accounts, not human users. API keys are simpler and more appropriate for machine-to-machine auth than JWT flows. Bearer token (JWT) is also supported for cases where the external system already has Nexus credentials.
