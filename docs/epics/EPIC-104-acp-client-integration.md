# EPIC-104: ACP Client Integration (Nexus → ACP)

Status: Proposed
Priority: P1
Depends On: EPIC-004 (Tool Registry), EPIC-050 (Capability Contracts), EPIC-080 (MCP pattern)
Related:
1. docs/architecture/mcp-integration.md
2. apps/api/src/mcp/ (pattern reference)
3. https://agentcommunicationprotocol.dev/spec/openapi.yaml
   Last Updated: 2026-04-15

---

## 1. Summary

Add Agent Communication Protocol client support so Nexus agents can discover and invoke external ACP-compatible agents, surfaced as Nexus tools through the existing capability governance pipeline.

This follows the established MCP integration pattern (EPIC-080) for module structure, entity design, API surface, and tool-registry bridging.

---

## 2. Problem

Current platform has MCP for tool integration and internal agent communication, but no way to interface with the broader ACP agent ecosystem:

1. No ACP server registry or connection management.
2. No discovery of external ACP agents.
3. No ability to invoke external ACP agents from within Nexus workflows.
4. No bridge between ACP message format and Nexus tool system.

---

## 3. Goals

1. Register and manage connections to external ACP servers.
2. Discover ACP agents and surface them as Nexus tools.
3. Invoke external ACP agents with sync, async, and stream run modes.
4. Handle ACP awaiting state by surfacing questions to the calling agent's user.
5. Enforce agent name include/exclude filters per server.

## 4. Non-Goals

1. Exposing Nexus agents as ACP servers (that is EPIC-105).
2. Full A2A protocol support (future consideration as spec matures).
3. ACP-MCP adapter deployment (use the existing acp-mcp adapter separately if needed).

---

## 5. ACP Protocol Reference

ACP is a REST-based protocol (spec v0.2.0) with these core operations:

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/ping` | Health check |
| GET | `/agents` | List available agents |
| GET | `/agents/{name}` | Get agent manifest |
| POST | `/runs` | Create a run (sync/async/stream) |
| GET | `/runs/{run_id}` | Get run status |
| POST | `/runs/{run_id}` | Resume an awaiting run |
| POST | `/runs/{run_id}/cancel` | Cancel a run |
| GET | `/runs/{run_id}/events` | Get run events |
| GET | `/session/{session_id}` | Get session details |

Key concepts:
- **Agent Manifest**: name, description, input/output content types, metadata, status
- **Messages**: Multi-part with role (`user`/`agent`/`agent/{name}`), content_type, content/content_url, metadata (citations, trajectory)
- **Run Lifecycle**: created → in-progress → completed | failed | cancelled; can transition to `awaiting` for pause/resume
- **Sessions**: Stateful conversations with history URLs and state URLs (distributed session pattern)
- **Run Modes**: `sync` (wait for completion), `async` (poll for result), `stream` (SSE events)

ACP has merged into A2A under the Linux Foundation. The TypeScript SDK (`acp-sdk`) is archived/read-only with client models only. We define our own types from the OpenAPI spec.

---

## 6. Architecture

### 6.1 Core Types Package (`@nexus/core`)

**File**: `packages/core/src/interfaces/acp.types.ts`

Define shared TypeScript types mirroring the ACP OpenAPI spec:

```
AcpTransportType = 'http'  // ACP is HTTP-only (no stdio)
AcpServerStatus = 'unknown' | 'connected' | 'failed' | 'disabled'
AcpRunStatus = 'created' | 'in-progress' | 'awaiting' | 'cancelling' | 'cancelled' | 'completed' | 'failed'
AcpRunMode = 'sync' | 'async' | 'stream'

// ACP protocol types
AcpMessage, AcpMessagePart, AcpCitationMetadata, AcpTrajectoryMetadata
AcpAgentManifest, AcpAgentName, AcpMetadata, AcpStatus
AcpRun, AcpRunCreateRequest, AcpRunResumeRequest
AcpEvent (union of message/RunState event types)
AcpSession, AcpError

// Nexus-internal types
IAcpServer (DB entity interface)
IAcpDiscoveredAgent (discovered agent cache)
IAcpServerTestResult
IAcpRunResult
IAcpInvokeAgentResult
```

### 6.2 Database Entities & Migration

**File**: `apps/api/src/database/entities/acp-server.entity.ts`

`acp_servers` table:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| name | varchar(120) UNIQUE | Human-readable server name |
| enabled | boolean default true | |
| url | text NOT NULL | ACP server base URL |
| auth_type | enum(none, bearer, api_key) | Authentication method |
| auth_token | text nullable | Bearer token or API key (encrypted at rest) |
| headers | jsonb nullable | Additional HTTP headers |
| timeout_ms | int default 30000 | Run request timeout |
| connect_timeout_ms | int default 10000 | Connection timeout |
| max_retries | int default 2 | Retry count for discovery |
| retry_backoff_ms | int default 1000 | Backoff between retries |
| default_run_mode | enum(sync, async, stream) default 'async' | Default mode for invocations |
| await_policy | enum(surface-to-user, auto-resume, fail) default 'surface-to-user' | How to handle ACP awaiting state |
| include_agents | jsonb nullable | Agent name include patterns (glob) |
| exclude_agents | jsonb nullable | Agent name exclude patterns (glob) |
| last_status | enum AcpServerStatus default 'unknown' | |
| last_error | text nullable | |
| last_connected_at | timestamptz nullable | |
| last_discovered_at | timestamptz nullable | |
| last_discovered_agent_count | int nullable | |
| created_at, updated_at | timestamptz | |

**File**: `apps/api/src/database/entities/acp-discovered-agent.entity.ts`

`acp_discovered_agents` table:

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| server_id | FK → acp_servers | |
| agent_name | varchar(63) | ACP AgentName (RFC 1123) |
| description | text | From manifest |
| input_content_types | jsonb | From manifest |
| output_content_types | jsonb | From manifest |
| manifest_metadata | jsonb nullable | Full metadata from manifest |
| registry_tool_name | varchar UNIQUE | Namespaced tool name in Nexus |
| is_registered | boolean default false | Whether tool is in tool_registry |
| created_at, updated_at | timestamptz | |

**Migration**: `apps/api/src/database/migrations/YYYYMMDDHHMMSS-create-acp-client-tables.ts`

### 6.3 ACP HTTP Client

**File**: `apps/api/src/acp/acp-http.client.ts`

A lightweight HTTP client implementing the ACP protocol against a single server URL:

- `ping(): Promise<void>`
- `listAgents(limit?, offset?): Promise<AcpAgentManifest[]>`
- `getAgent(name): Promise<AcpAgentManifest>`
- `createRun(req: AcpRunCreateRequest): Promise<AcpRun | EventStream>`
- `getRun(runId): Promise<AcpRun>`
- `resumeRun(runId, req: AcpRunResumeRequest): Promise<AcpRun | EventStream>`
- `cancelRun(runId): Promise<AcpRun>`
- `listRunEvents(runId): Promise<AcpEvent[]>`
- `getSession(sessionId): Promise<AcpSession>`

Authentication handling:
- No auth / Bearer token / API key header injection
- Custom headers merging
- Timeout enforcement with AbortController

### 6.4 ACP Runtime Manager

**File**: `apps/api/src/acp/acp-runtime-manager.service.ts`

Implements `OnApplicationBootstrap` for auto-discovery at startup.

Key responsibilities:

1. **Discovery**: On startup and on reload, iterate all enabled servers, call `listAgents()`, cache manifests in `acp_discovered_agents`, and register each as a Nexus tool.

2. **Tool Registration**: For each discovered agent, create a tool registry entry:
   - Name: `acp_{namespace12}_{sanitized_name}_{hash8}` (same pattern as MCP)
   - Schema: Convert ACP manifest input/output content types + metadata to a Nexus-compatible JSON Schema with `x-nexus-acp` annotation
   - TypeScript code: Stub (actual invocation routes through API callback)
   - API callback: `POST /api/acp/servers/{serverId}/agents/{agentName}/invoke`

3. **Invocation**: When a Nexus agent calls the tool:
   - Convert Nexus tool call params → ACP Message format
   - Determine run mode (sync/async/stream) from server config or per-call override
   - Execute via ACP HTTP client
   - Handle async polling (for `async` mode)
   - Handle awaiting state → surface as agent question or auto-resolve based on `await_policy`
   - Convert ACP response Messages back to Nexus tool result format

4. **Lifecycle**: Reload, reconnect, error tracking, circuit-breaker patterns (similar to MCP runtime manager)

### 6.5 ACP Service (CRUD + Delegation)

**File**: `apps/api/src/acp/acp.service.ts`

Similar to `McpService`:
- CRUD for ACP server configs
- Validation (URL required, auth type consistency)
- Delegation to runtime manager for test/reload/invoke

### 6.6 ACP Controller (Management API)

**File**: `apps/api/src/acp/acp.controller.ts`

| Method | Route | Roles | Purpose |
|--------|-------|-------|---------|
| GET | `/acp/servers` | Admin, Developer | List servers |
| POST | `/acp/servers` | Admin | Create server |
| PATCH | `/acp/servers/:id` | Admin | Update server |
| DELETE | `/acp/servers/:id` | Admin | Delete server |
| POST | `/acp/servers/:id/test` | Admin, Developer | Test connection |
| POST | `/acp/servers/:id/reload` | Admin, Developer | Reload/re-discover |
| POST | `/acp/reload` | Admin, Developer | Reload all servers |
| GET | `/acp/servers/:id/agents` | Admin, Developer | List discovered agents |
| GET | `/acp/servers/:id/agents/:agentName` | Admin, Developer | Get agent manifest |
| POST | `/acp/servers/:id/agents/:agentName/invoke` | Admin, Developer, Agent | Invoke agent |

### 6.7 ACP Module

**File**: `apps/api/src/acp/acp.module.ts`

NestJS module importing DatabaseModule, providing AcpService, AcpRuntimeManagerService, AcpHttpClient, AcpController.

### 6.8 Utility Modules

| File | Purpose |
|------|---------|
| `apps/api/src/acp/acp-tool-name.utils.ts` | Namespace generation (`buildAcpServerNamespace`, `buildAcpToolPrefix`, `buildAcpRegistryToolName`, `buildAcpInvokePath`) |
| `apps/api/src/acp/acp-schema.utils.ts` | ACP manifest → Nexus JSON Schema conversion with `x-nexus-acp` metadata |
| `apps/api/src/acp/acp-message.utils.ts` | Nexus tool params ↔ ACP Message format conversion |
| `apps/api/src/acp/acp-filter.utils.ts` | Agent include/exclude name filtering (reuse glob pattern logic from MCP) |
| `apps/api/src/acp/acp-runtime.constants.ts` | Protocol version, default timeouts, bridge TypeScript stub |
| `apps/api/src/acp/dto/*.ts` | CreateAcpServerDto, UpdateAcpServerDto, InvokeAcpAgentDto |

### 6.9 ACP Tool Bridge (Agent Runtime Integration)

When a Nexus agent (running in pi-runner) encounters an ACP-derived tool, the invocation flows:

1. Agent calls tool (e.g., `acp_a1b2c3d4e5f6_translator_9h8g7f6e`)
2. pi-runner sends tool call via telemetry to API
3. API resolves `api_callback` → `POST /api/acp/servers/{serverId}/agents/{agentName}/invoke`
4. `AcpController.invokeAgent` → `AcpService.invokeAgent` → `AcpRuntimeManagerService.invokeAgent`
5. Runtime manager converts tool params to ACP `RunCreateRequest`
6. Executes via `AcpHttpClient.createRun` (with configured run mode)
7. For async mode: polls `getRun` until terminal state
8. For awaiting state: maps to pi-runner `ask_user_questions` (default) or auto-resumes based on `await_policy`
9. Converts ACP response messages back to tool result format
10. Returns to agent

### 6.10 Observability

Emit events via `EventLedgerService`:
- `acp.reload.succeeded` / `acp.reload.failed`
- `acp.invoke.succeeded` / `acp.invoke.failed`
- `acp.discovery.succeeded` / `acp.discovery.failed`

Prometheus metrics:
- `acp_server_discovered_agents` gauge
- `acp_invoke_duration_seconds` histogram
- `acp_invoke_total` counter by server/agent/status

### 6.11 UI Panel

**Files**:
- `apps/web/src/hooks/useAcpServers.ts`
- `apps/web/src/pages/settings/AcpServersCard.tsx`
- `apps/web/src/pages/settings/AcpServerFormDialog.tsx`

Settings page card with:
- Server list with status indicators
- Add/edit server dialog (URL, auth config, timeouts)
- Test connection button
- Discovered agents list with manifest details
- Run mode and await policy configuration

---

## 7. Workstreams & Backlog

| ID | Task | Estimate |
|----|------|----------|
| E104-001 | Core types in `@nexus/core` | S |
| E104-002 | Database entities, repositories, and migration | S |
| E104-003 | ACP HTTP client | M |
| E104-004 | ACP runtime manager (discovery, registration, invocation) | L |
| E104-005 | ACP service (CRUD + validation) | S |
| E104-006 | ACP controller (management API) | S |
| E104-007 | Utility modules (names, schemas, messages, filters, constants) | M |
| E104-008 | Agent filtering (include/exclude) | S |
| E104-009 | Async run polling and awaiting state handling | M |
| E104-010 | Observability (events, metrics) | S |
| E104-011 | DTOs with class-validator | S |
| E104-012 | ACP module registration and app wiring | S |
| E104-013 | UI: ACP server management panel | M |
| E104-014 | Integration tests (connect, discover, invoke, filter) | M |
| E104-015 | Architecture documentation | S |

---

## 8. Implementation Order — Estimated 3-4 weeks

1. **E104-001**: Core types in `@nexus/core` (1 day)
2. **E104-002**: Database entity, repository, migration (1 day)
3. **E104-003**: ACP HTTP client (2-3 days)
4. **E104-007**: Utility modules (2 days)
5. **E104-004**: ACP runtime manager (3-4 days)
6. **E104-005 + E104-006**: Service + Controller (1-2 days)
7. **E104-008**: Agent filtering (0.5 days)
8. **E104-009**: Async polling and await handling (2 days)
9. **E104-010 + E104-011**: Observability + DTOs (1 day)
10. **E104-012**: Module wiring (0.5 days)
11. **E104-013**: UI panel (2-3 days)
12. **E104-014**: Integration tests (2-3 days)
13. **E104-015**: Architecture docs (0.5 days)

---

## 9. Acceptance Criteria

1. ACP servers can be registered, tested, and managed via API
2. Discovered agents appear in runtime tool catalog with namespace metadata
3. Include/exclude agent name patterns are enforced
4. Nexus agents can invoke external ACP agents through the tool bridge
5. Sync, async, and stream run modes are supported
6. Awaiting state is surfaced back to the calling agent appropriately (default: surface to user)
7. Server connection status and diagnostics are visible via API
8. Reload discovers new agents without restart

---

## 10. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| ACP server instability (timeouts, crashes) | Retry with backoff, status tracking, circuit-breaker pattern |
| Long-running agent tasks blocking | Async mode with polling; configurable timeouts; run cancellation |
| ACP message format complexity | Comprehensive message conversion utilities; content_url handling |
| Agent name collisions across servers | Deterministic namespace prefix with collision-resistant hashing |
| Awaiting state requires human input | Map to pi-runner question tool; configurable await_policy per server |
| ACP spec version changes | Pin to v0.2.0; version negotiation in client headers |

---

## 11. Design Decisions

1. **Custom types from spec**: The `acp-sdk` npm package is archived/read-only. We define our own types in `@nexus/core` to maintain control and spec alignment.

2. **Default run mode**: `async` for outgoing invocations. Agents typically need to wait for results but shouldn't block the event loop. `sync` for short operations, `stream` when the calling agent needs incremental output.

3. **Await policy**: Surface to user by default — map ACP `awaiting` state to the Nexus `ask_user_questions` tool so the calling agent's user can respond. Per-server configurable with options: `surface-to-user` (default), `auto-resume`, `fail`.
