---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: mcp-integration
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/api/src/mcp/mcp-runtime-manager.service.ts
  - apps/api/src/mcp/mcp-transport-factory.ts
  - apps/api/src/mcp/mcp-transport-http.client.ts
  - apps/api/src/mcp/mcp-transport-stdio.client.ts
  - apps/api/src/mcp/mcp-reconciliation-loop.ts
  - apps/api/src/mcp/mcp.controller.ts
  - apps/api/src/mcp/mcp-jsonrpc.utils.ts
source_paths:
  - apps/api/src/mcp
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: MCP Client Runtime

## Narrative Summary

The MCP Client Runtime (`mcp-integration` scope) is fully implemented with comprehensive coverage of external MCP server discovery, tool synchronization, and invocation. The implementation supports both HTTP and STDIO transport mechanisms, implements a background reconciliation loop for periodic server refresh, and integrates with the capability registry system for tool projection. All REST endpoints are protected with JWT auth and role-based guards.

## Capability Updates

**Tool Discovery & Synchronization**
- `McpRuntimeManagerService` extends `BasePluginRuntimeManagerService` to manage MCP server lifecycle
- Tool discovery via `McpTransportFactory.listTools()` filters tools against `include_tools` and `exclude_tools` patterns
- Each discovered tool is registered under both a hashed stable name (e.g., `mcp_<12-char-hash>_<sanitized-name>_<8-char-hash>`) and its original remote name for direct callable access
- Server status tracked in DB: `CONNECTED`, `FAILED`, `DISABLED`; timestamps for last connection and last discovery

**Transport Layer**
- `McpHttpTransportClient`: HTTP POST to MCP server URL with JSON-RPC 2.0; includes `Content-Length` framing via fetch API; runtime context headers (`x-workflow-run-id`, `x-job-id`, `x-step-id`) forwarded to MCP server
- `McpStdioTransportClient`: Spawns child process with `stdio: 'pipe`; implements Content-Length framing protocol per MCP spec; session-per-call pattern with process spawn timeout protection
- `McpTransportFactory`: Routes requests by `McpTransportType` enum (HTTP vs STDIO)

**JSON-RPC Protocol**
- `createInitializeRequest()`: Sends `initialize` with `protocolVersion: 2024-11-05`, clientInfo: `nexus-orchestrator/0.0.1`
- `createInitializedNotification()`: Sends `notifications/initialized` after handshake
- `createListToolsRequest()` / `createCallToolRequest()`: Standard tool.list and tools.call methods

**Background Reconciliation**
- `McpReconciliationLoop`: Schedules periodic reload of all servers; backoff on failure streak (up to 4× multiplier); configurable via `MCP_RECONCILIATION_INTERVAL_MS`, `MCP_RECONCILIATION_JITTER_MS`, `MCP_RECONCILIATION_ENABLED`
- Uses `EventLedgerService` for telemetry: `mcp.reconcile.scheduled.*` events

**REST API Surface** (`McpController`)
- `GET /mcp/servers` — List server configs
- `POST /mcp/servers` — Create server (Admin only)
- `PATCH /mcp/servers/:id` — Update server (Admin only)
- `DELETE /mcp/servers/:id` — Delete server (Admin only)
- `POST /mcp/servers/:id/test` — Test connectivity (Admin, Developer)
- `GET /mcp/servers/:id/tools` — List registered tools for server
- `POST /mcp/servers/:id/reload` — Reload single server
- `POST /mcp/reload` — Reload all servers
- `POST /mcp/servers/:id/tools/:toolName/invoke` — Invoke remote tool (Admin, Developer, Agent roles)

**Retry & Error Handling**
- `discoverItemsWithRetry()`: Retries with exponential backoff (`server.retry_backoff_ms * (attempt + 1)`)
- Error messages extracted from `Error.message` or defaulted to `'Unknown MCP runtime error'`
- Server lookup by UUID or stable name

## Health Findings

**Test Coverage** (5 spec files)
- ✅ `mcp-filter.utils.spec.ts` — include/exclude filter patterns, case-insensitive wildcard
- ✅ `mcp-runtime-manager.service.spec.ts` — reload flow, dual registration, disabled server handling, tool invocation, name resolution
- ✅ `mcp-transport-http.client.spec.ts` — runtime context header forwarding
- ✅ `mcp.controller.spec.ts` — REST delegation, runtime context header extraction, response envelope
- ✅ `mcp.service.spec.ts` — CRUD operations, server reload trigger, tool listing by name

**Missing Tests**
- `mcp-transport-stdio.client.ts` — no spec file
- `mcp-reconciliation-loop.ts` — no spec file
- `mcp-jsonrpc.utils.ts` — no spec file (parse functions)
- `mcp-schema.utils.ts` — no spec file
- `mcp-tool-name.utils.ts` — no spec file
- `mcp-runtime-manager.utils.ts` — no spec file

**Code Quality**
- Clean separation: controller → service → runtime manager → transport factory → HTTP/STDIO clients
- No TODO/FIXME comments observed
- TypeScript types for all interfaces; `McpServer` entity with proper TypeORM decorators
- Indexes on `enabled` and `last_status` for query performance

**Churn Signals**
- Single spec file has recent update (`mcp-transport-http.client.spec.ts` dated 2026-05-22)
- No excessive inline comments; production-ready code

## Open Questions

1. **Stdio client test gap**: `McpStdioTransportClient` has no unit test; edge cases around process spawn failure, stderr handling, and Content-Length parsing are not verified
2. **Reconciliation loop test gap**: Backoff behavior, failure streak increment, and disabled loop scenarios lack coverage
3. **JSON-RPC parsing edge cases**: `parseJsonRpcResponse`, `parseToolsListResult`, and `parseToolCallResult` have no dedicated unit tests
4. **Schema build edge cases**: `buildMcpRegistrySchema` fallback behavior not explicitly tested
5. **Tool name collision**: Multiple MCP servers could theoretically generate the same hashed registry name if tool names and server IDs collide; not tested