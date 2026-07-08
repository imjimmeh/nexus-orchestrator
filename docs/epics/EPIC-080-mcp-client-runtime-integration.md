# EPIC-080: MCP Client Runtime Integration

Status: Completed
Priority: P0
Depends On: EPIC-004, EPIC-050
Last Updated: 2026-04-12

---

## 1. Summary

Add Model Context Protocol client support so Nexus can connect to external MCP servers and expose discovered tools through existing capability governance.

This closes a major ecosystem gap and can be implemented fully in apps/api without service splitting.

---

## 2. Problem

Current platform has dynamic tools and skills, but no MCP surface:

1. No MCP server registry.
2. No discovery/connect lifecycle.
3. No ability to import external MCP tool ecosystems.

---

## 3. Goals

1. Support stdio and HTTP MCP connections.
2. Discover and register MCP tools dynamically.
3. Enforce per-server allow and deny filters.
4. Map MCP tools into existing toolset and profile policies.

## 4. Non-Goals

1. Full MCP server mode for Nexus (handled separately if needed).
2. Arbitrary auto-execution of unapproved MCP tools.

---

## 5. Architecture

### 5.1 Server Registry

Add MCP server config model:

1. id, name, enabled, transport_type (stdio/http)
2. command and args or url and headers
3. tool include/exclude filters
4. timeout and connect timeout

### 5.2 MCP Runtime Manager

1. Manage connection lifecycle and retries.
2. Discover tool schemas at startup and on reload.
3. Emit diagnostics for connection and discovery failures.

### 5.3 Tool Registration

1. Register discovered tools into ToolRegistryService using namespace prefix mcp_server_tool.
2. Track provenance and server binding metadata.
3. Reconcile tool diffs on reload.

### 5.4 API

1. GET /mcp/servers
2. POST /mcp/servers
3. PATCH /mcp/servers/:id
4. DELETE /mcp/servers/:id
5. POST /mcp/servers/:id/test
6. POST /mcp/reload

---

## 6. Workstreams

1. MCP config entities and repository.
2. MCP runtime manager and discovery adapter.
3. Tool registry reconciliation and namespacing.
4. API management and test endpoint.
5. UI management panel and status indicators.

---

## 7. Backlog

- [x] E080-001 Add MCP server config entity and migration.
- [x] E080-002 Implement stdio transport connector.
- [x] E080-003 Implement HTTP transport connector.
- [x] E080-004 Implement discovery and tool schema normalization.
- [x] E080-005 Implement per-server include and exclude filtering.
- [x] E080-006 Integrate discovered tools with ToolRegistryService.
- [x] E080-007 Add runtime reload and reconnect controls.
- [x] E080-008 Add management API and role guards.
- [x] E080-009 Add UI panel for MCP server management.
- [x] E080-010 Add integration tests for connect, discover, and filter.

---

## 8. Acceptance Criteria

1. MCP servers can be registered and tested via API.
2. Discovered tools appear in runtime tool catalog with namespace metadata.
3. Include and exclude policies are enforced.
4. Reload updates tool catalog without restart.

---

## 9. Risks and Mitigation

1. Tool naming collisions.
   - Mitigate with deterministic prefix namespace.
2. Unstable remote MCP endpoints.
   - Mitigate with health status and circuit-breaker style retry backoff.
