# MCP (Model Context Protocol) Integration (EPIC-080)

The MCP module integrates external MCP servers into the Nexus platform, enabling dynamic tool discovery, lifecycle management, and runtime tool invocation. MCP tools are automatically registered into the Nexus tool registry and participate in the standard governance pipeline.

## Module Registration

`McpModule` is registered in `AppModule`. It imports `DatabaseModule` and exports `McpService` and `McpRuntimeManagerService`.

## Architecture

### Core Services

| Service | Responsibility |
|---------|---------------|
| `McpService` | CRUD operations for MCP server configurations |
| `McpRuntimeManagerService` | Runtime lifecycle: connect, discover tools, reload, invoke |
| `McpTransportFactory` | Creates transport clients based on server configuration |
| `McpHttpTransportClient` | HTTP/SSE transport implementation |
| `McpStdioTransportClient` | Stdio transport implementation |
| `McpReconciliationLoop` | Periodic reconnection and tool re-sync |

### Transport Types

| Type | Description |
|------|-------------|
| `http` | HTTP-based MCP server with optional SSE streaming |
| `stdio` | Local process MCP server via stdin/stdout |

### Tool Discovery and Registry Integration

When an MCP server is connected or reloaded:

1. The runtime manager connects using the configured transport
2. Available tools are discovered via the MCP protocol (`tools/list`)
3. Discovered tools are reconciled against the Nexus tool registry
4. New tools are registered via `CapabilityRegistrarService.registerToolProjection()`
5. Stale tools (no longer advertised) are removed
6. Tool name filtering is applied via `include_tools` and `exclude_tools` on the server config

### Runtime Tool Invocation

MCP tools can be invoked through:

1. **API endpoint** — `POST /api/mcp/servers/:id/tools/:toolName/invoke` (available to Admin, Developer, and Agent roles)
2. **Standard tool execution** — Registered MCP tools include API callback metadata that routes through the tool registry's standard execution path (`/api/tools/runtime/:toolName/execute`)

MCP tool execution respects the standard governance pipeline:
- Preflight capability resolution
- Static permission checks
- Dynamic approval rules
- Human approval workflows (if required)

## Entity: `mcp_servers`

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid PK | Auto-generated |
| `name` | varchar(120) | Unique server identifier |
| `enabled` | boolean | Active flag (default: true) |
| `transport_type` | enum `McpTransportType` | `stdio`, `http` |
| `command` | text | Executable command (stdio only) |
| `args` | jsonb (string[]) | Command arguments (stdio only) |
| `url` | text | Server URL (http only) |
| `headers` | jsonb | HTTP headers (http only) |
| `include_tools` | jsonb (string[]) | Tool whitelist (empty = all) |
| `exclude_tools` | jsonb (string[]) | Tool blacklist |
| `timeout_ms` | int | Tool invocation timeout (default: 30000) |
| `connect_timeout_ms` | int | Connection timeout (default: 10000) |
| `max_retries` | int | Retry count (default: 2) |
| `retry_backoff_ms` | int | Retry backoff (default: 1000) |
| `last_status` | enum `McpServerStatus` | `unknown`, `connected`, `failed`, `disabled` |
| `last_error` | text | Last connection error |
| `last_connected_at` | timestamptz | Last successful connection |
| `last_discovered_at` | timestamptz | Last tool discovery |
| `last_discovered_tool_count` | int | Number of tools found |

## API Routes

All routes are under `@Controller('mcp')`.

| Method | Route | Roles | Description |
|--------|-------|-------|-------------|
| GET | `/mcp/servers` | Admin, Developer | List MCP server configurations |
| POST | `/mcp/servers` | Admin | Create MCP server configuration |
| PATCH | `/mcp/servers/:id` | Admin | Update MCP server configuration |
| DELETE | `/mcp/servers/:id` | Admin | Delete MCP server configuration |
| POST | `/mcp/servers/:id/test` | Admin, Developer | Test server connectivity |
| POST | `/mcp/servers/:id/reload` | Admin, Developer | Reload server tool catalog |
| POST | `/mcp/reload` | Admin, Developer | Reload all enabled servers |
| POST | `/mcp/servers/:id/tools/:toolName/invoke` | Admin, Developer, Agent | Invoke MCP tool |

## Tool Naming and Namespacing

MCP tools are registered with namespaced names to prevent collisions:

```
mcp_{serverNamespace}_{safeToolName}_{hash}
```

Where:
- `serverNamespace` = 12-character hash of server ID
- `safeToolName` = sanitized tool name (lowercase, alphanumeric + underscores)
- `hash` = 8-character hash of original tool name

Example: `mcp_a1b2c3d4e5f6_list_files_abc123def`

The namespace ensures tools from different MCP servers don't collide even if they have the same original name.

## Schema Conversion

MCP tool schemas are converted to Nexus JSON Schema format:

```typescript
interface McpRegistryPayload {
  name: string;  // Namespaced tool name
  schema: Record<string, unknown>;  // JSON Schema with x-nexus-mcp metadata
  typescript_code: string;  // MCP_TOOL_BRIDGE_TYPESCRIPT_CODE
  tier_restriction: 0;  // MCP tools are always tier 0 (LIGHT)
  mcp_server_id: string;
  api_callback: {
    method: 'POST';
    path_template: `/api/mcp/servers/{serverId}/tools/{toolName}/invoke`;
  };
}
```

The schema includes `x-nexus-mcp` metadata:

```json
{
  "x-nexus-mcp": {
    "namespace": "mcp",
    "server_id": "...",
    "server_name": "...",
    "transport_type": "http",
    "remote_tool_name": "list_files",
    "registry_tool_name": "mcp_a1b2c3d4e5f6_list_files_abc123def"
  }
}
```

## Reconciliation Loop

The `McpReconciliationLoop` runs periodically (default: every 5 minutes) to:

1. Check health of all enabled MCP servers
2. Reconnect failed servers with exponential backoff
3. Reload tool catalogs for servers with connectivity restored
4. Remove tools from disabled servers

Configuration via environment variables:
- `MCP_RECONCILIATION_ENABLED` (default: `true`)
- `MCP_RECONCILIATION_INTERVAL_MS` (default: `300000`)
- `MCP_RECONCILIATION_JITTER_MS` (default: `30000`)

## Error Handling

- **Connection failures**: Logged and server marked as `failed`
- **Tool invocation failures**: Returned as `400 Bad Request` with error details
- **Retry logic**: Exponential backoff with configurable max retries
- **Timeouts**: Configurable per-server, default 30s for tool invocation

## Security Considerations

- **Create/update/delete** operations restricted to `Admin` role
- **Tool invocation** available to `Agent` role for runtime execution
- **Network access** governed by MCP server's own transport configuration
- **Tool name namespacing** prevents collisions between servers
- **No secret exposure**: MCP servers receive only the parameters explicitly passed in tool invocation
- **CORS and authentication**: HTTP transport respects standard web security practices

## UI Integration

MCP server management is embedded in the **Settings page** (`/settings`) as a dedicated card:

- Create/edit/delete MCP server configurations
- Test server connectivity
- Reload individual or all servers
- Configure include/exclude tool filters
- View connection status and discovered tool count

## Example: Adding an MCP Server

1. **Create server configuration**:
```json
POST /api/mcp/servers
{
  "name": "file-system-tools",
  "transport_type": "stdio",
  "command": "python",
  "args": ["/path/to/mcp-server-filesystem.py", "/workspace"],
  "include_tools": ["list_files", "read_file"],
  "exclude_tools": ["delete_file"]
}
```

2. **Server connects and discovers tools**:
- Status changes to `connected`
- Tools registered in tool registry with `mcp_` prefix
- Tools appear in agent profile tool lists

3. **Agent uses tool**:
```json
POST /api/tools/runtime/mcp_a1b2c3d4e5f6_list_files_abc123def/execute
{
  "params": {"path": "/workspace/docs"}
}
```

4. **Governance applies**:
- Preflight checks agent profile permissions
- Dynamic approval rules evaluated (if configured)
- Tool executes in sandbox (for artifact-based tools) or via API callback

## Related Documentation

- `docs/architecture/tool-registry.md` - Tool registry and capability system
- `docs/architecture/tool-permissions-and-approvals.md` - Governance and approval rules
- `docs/architecture/rest-api.md` - API endpoint reference
- `packages/pi-runner/src/session/session-factory.ts` - Runner-side tool wrapping
- `apps/api/src/tool/capability-preflight.service.ts` - Preflight capability resolution