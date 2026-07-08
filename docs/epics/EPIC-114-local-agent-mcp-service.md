# EPIC-114: Local Agent MCP Service

Status: Proposed  
Priority: P1  
Depends On: EPIC-080, EPIC-081  
Last Updated: 2026-04-17  
Owner: TBD  

---

## 1. Summary

Build a lightweight, installable MCP server (`nexus-agent-local`) that allows Nexus agents to execute arbitrary commands on user machines. The service exposes command execution as an MCP tool, integrating seamlessly with the existing MCP client runtime and tool governance framework.

This enables a new class of workflows where agents can:
- Execute local build and test commands
- Manage files and directories on the user's machine
- Integrate with local development environments (IDEs, package managers, version control)
- Orchestrate multi-system tasks across cloud and local infrastructure
- Support hands-on coding workflows where agents make changes locally and push to version control

The service is designed for MVP simplicity, with a roadmap for security hardening, transport encryption, authentication, and audit logging as future capabilities.

---

## 2. Current-State Baseline

### 2.1 Existing capabilities

1. **MCP Client Runtime**: EPIC-080 completed full MCP client integration with stdio and HTTP transports, tool discovery, and capability mapping.
   - File: `apps/api/src/mcp/mcp-runtime.service.ts`
   - File: `apps/api/src/mcp/mcp-server.controller.ts`

2. **Tool Registry and Governance**: Existing tool registration, profile-based access control, and capability contracts.
   - File: `apps/api/src/tool/tool-registry.service.ts`
   - File: `apps/api/src/agent-profile/agent-profile.service.ts`

3. **Workflow Tool Execution**: Workflow engine already supports tool steps and execution context.
   - File: `apps/api/src/orchestration/workflow-engine.service.ts`

4. **CLI Distribution Patterns**: Project already has npm workspaces and deployment patterns in place.
   - Ref: `packages/*`, `apps/*`

### 2.2 Critical gaps this epic closes

1. No pre-built MCP service for local machine command execution.
2. No documented pattern for users to install and run a daemon on their machine.
3. No security model for command allowlist, audit logging, or transport encryption.
4. No integration contract between Nexus agent profiles and local machine capabilities.
5. No tooling or documentation for developers who want to test agents against local machines during development.

---

## 3. Problem Statement

Current Nexus agents can execute tools in remote containers and via external MCP servers, but they cannot execute arbitrary commands on a user's local machine. Many real-world workflows require this:

- A developer wants an agent to run tests on their machine before pushing changes.
- A project manager wants an agent to execute local scripts and report results.
- A DevOps engineer wants agents to perform provisioning tasks on target infrastructure.
- A researcher wants to run local analysis scripts and feed results back into workflows.

Without a local execution capability, Nexus remains limited to cloud-only orchestration. Users either must:
1. SSH into machines and manually run commands (defeating automation).
2. Set up complex remote execution infrastructure (heavy lift for small use cases).
3. Duplicate workloads into containers (loss of local context, development tools).

The solution is a simple, installable MCP service that users run locally, secured by the same governance model as remote tools.

---

## 4. Goals

1. **MVP Local Execution**: Provide a minimal MCP server that exposes command execution (`exec`) and file operations (`read`, `write`, `delete`, `list`) as tools.

2. **Seamless Nexus Integration**: The service integrates with existing MCP client runtime without requiring platform changes.

3. **User Installation Experience**: Users can install via `npm install -g nexus-agent-local` and run with minimal configuration.

4. **Security Foundation**: Implement a basic allowlist for permitted commands; allow agent profiles to declare which machines they can access.

5. **Local Development UX**: Support developers who want to test agents against local machines in development mode.

6. **Operator Diagnostics**: Provide clear status, logging, and health check endpoints for troubleshooting.

7. **Future-Proof Design**: Architecture should allow for SSH tunneling, mTLS, audit logging, and rate limiting as follow-up work.

---

## 5. Non-Goals

1. **Kubernetes orchestration**: This epic does not cover deploying the service as a sidecar or orchestrated workload.
2. **Automatic discovery**: Users must explicitly register their local service with Nexus; no auto-discovery in MVP.
3. **Symmetric transport encryption**: MVP supports plaintext over localhost; TLS/mTLS is a follow-up.
4. **Arbitrary shell injection**: Service implements safe argument passing; no `shell=true` by default.
5. **Replacing existing SSH/remote execution patterns**: This is an addition, not a replacement.

---

## 6. Desired End-State Behavior

### 6.1 Installation and deployment

1. Users can install the service globally:
   ```bash
   npm install -g nexus-agent-local
   ```

2. Users can start the service with minimal config:
   ```bash
   nexus-agent-local start
   ```

3. The service listens on `http://localhost:3033` (configurable via `NEXUS_LOCAL_PORT`).

4. The service exposes MCP discovery via stdio or HTTP transport.

5. Users can register the service with their Nexus instance by adding an MCP server config:
   ```json
   {
     "name": "My Local Machine",
     "transport_type": "http",
     "url": "http://localhost:3033/mcp"
   }
   ```

### 6.2 Tool contract

The service exposes tools with the following schema:

#### `exec` Tool
```typescript
{
  name: "exec",
  description: "Execute a command on the local machine",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", description: "Command to execute" },
      args: { type: "array", items: { type: "string" }, description: "Command arguments" },
      cwd: { type: "string", description: "Working directory (optional)" },
      timeout: { type: "number", description: "Timeout in ms (default: 30000)" }
    },
    required: ["command"]
  }
}
```

#### `read_file` Tool
```typescript
{
  name: "read_file",
  description: "Read a file from the local machine",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Absolute or relative file path" },
      encoding: { type: "string", enum: ["utf8", "base64"], default: "utf8" }
    },
    required: ["path"]
  }
}
```

#### `write_file` Tool
```typescript
{
  name: "write_file",
  description: "Write or overwrite a file on the local machine",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      content: { type: "string" },
      mode: { type: "number", description: "File permissions (octal)" }
    },
    required: ["path", "content"]
  }
}
```

#### `ls` Tool
```typescript
{
  name: "ls",
  description: "List directory contents",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      recursive: { type: "boolean", default: false }
    },
    required: ["path"]
  }
}
```

#### `delete` Tool
```typescript
{
  name: "delete",
  description: "Delete a file or directory",
  inputSchema: {
    type: "object",
    properties: {
      path: { type: "string" },
      recursive: { type: "boolean", default: false, description: "For directories, delete recursively" }
    },
    required: ["path"]
  }
}
```

### 6.3 Security model (MVP)

1. **Command Allowlist**: Service reads an optional allowlist from `~/.nexus-agent-local/allowlist.json`:
   ```json
   {
     "patterns": [
       "npm run *",
       "npm test",
       "git add *",
       "git commit -m *",
       "pytest *"
     ]
   }
   ```

2. **Path Restrictions**: File operations are restricted to user's home directory and current working directory by default.

3. **Profile Binding**: Agent profiles can declare machine access via workflow step constraints.

4. **Local-Only Binding**: MVP only listens on localhost; remote access requires explicit config and is documented as experimental.

### 6.4 Operator experience

1. Health check endpoint: `GET http://localhost:3033/health` → `{ status: "ok", version: "1.0.0" }`.

2. Diagnostics endpoint: `GET http://localhost:3033/diagnostics` → tool list, configuration, error log.

3. Logs can be streamed to stdout or written to `~/.nexus-agent-local/logs/`.

4. Configuration is user-friendly:
   ```bash
   nexus-agent-local config set allowlist.path /path/to/allowlist.json
   nexus-agent-local config set log.level debug
   ```

### 6.5 Workflow integration

Agents can invoke the local service in workflow steps:

```yaml
jobs:
  test:
    steps:
      - type: tool
        name: Run Local Tests
        tool: nexus_local_exec
        inputs:
          command: npm
          args: [test]
        conditions:
          - profile: backend-engineer
            machine: my-laptop
```

---

## 7. Architecture

### 7.1 Service anatomy

```
packages/agent-local/
├── src/
│   ├── index.ts                 # CLI entry point and daemon launcher
│   ├── mcp-server.ts            # MCP server implementation
│   ├── tool-handlers/
│   │   ├── exec.handler.ts
│   │   ├── file-ops.handler.ts
│   │   └── dir-ops.handler.ts
│   ├── security/
│   │   ├── command-allowlist.ts
│   │   ├── path-validator.ts
│   │   └── audit-logger.ts
│   ├── config/
│   │   ├── config.loader.ts
│   │   └── defaults.ts
│   ├── http/
│   │   ├── http-server.ts
│   │   ├── routes.ts
│   │   └── middleware.ts
│   └── utils/
│       ├── process.utils.ts
│       └── file.utils.ts
├── cli.ts                       # CLI commands (start, config, status)
├── package.json
├── tsconfig.json
└── README.md
```

### 7.2 Transport strategy

**MVP**: HTTP transport only (simpler for users, more compatible).

- Service runs HTTP server on `http://localhost:3033`.
- Nexus MCP client connects via HTTP transport from EPIC-080.
- MCP discovery and tool calls over HTTP/JSON-RPC.

**Future**: Optionally support stdio transport for container integration (EPIC-081 plugin SDK).

### 7.3 Data flow

```
User Machine                          Nexus Control Plane
┌─────────────────────────────────┐   ┌──────────────────────────┐
│ nexus-agent-local               │   │ apps/api                 │
│ ┌───────────────────────────────┤   │ ┌──────────────────────┐ │
│ │ HTTP Server:3033              │◄──┼─│ MCP Runtime Service  │ │
│ │ ┌─────────────────────────────┤   │ │ (from EPIC-080)      │ │
│ │ │ MCP Tools Handler           │   │ │ - HTTP connector     │ │
│ │ │ - exec                      │   │ │ - Discovery          │ │
│ │ │ - read_file                 │   │ │ - Tool registration  │ │
│ │ │ - write_file                │   │ │ - Execution bridge   │ │
│ │ │ - ls                  │   │ └──────────────────────┘ │
│ │ │ - delete                    │   │                          │
│ │ └─────────────────────────────┤   │ Tool Registry Service    │
│ │                               │   │ (from EPIC-004)          │
│ │ Allowlist Enforcer            │   │ - Tool governance        │
│ │ Path Validator                │   │ - Profile access control │
│ │ Audit Logger                  │   │ - Capability binding     │
│ └───────────────────────────────┤   └──────────────────────────┘
│ Config (allowlist.json)         │
│ Logs (~/.nexus-agent-local)     │
└─────────────────────────────────┘
```

### 7.4 Tool registration flow

1. User registers MCP server in Nexus:
   ```
   POST /mcp/servers
   { "name": "My Laptop", "url": "http://localhost:3033/mcp" }
   ```

2. MCP Runtime Service discovers tools via:
   ```
   POST http://localhost:3033/mcp
   { "jsonrpc": "2.0", "method": "initialize", ... }
   ```

3. Discovered tools are registered with Tool Registry as `mcp_my_laptop_exec`, `mcp_my_laptop_read_file`, etc.

4. Agent profiles declare which tools they can access via existing governance.

5. Workflow steps invoke tools by name; execution bridges to local service.

---

## 8. Implementation Workstreams

### 8.1 Core service foundation (Phase 1)

- [ ] **E114-001**: Create `packages/agent-local` with npm workspaces integration.
- [ ] **E114-002**: Implement HTTP server and MCP transport adapter.
- [ ] **E114-003**: Implement `exec` tool handler with safe argument passing.
- [ ] **E114-004**: Implement `read_file`, `write_file`, `ls`, `delete` tools.
- [ ] **E114-005**: Add path validation and home-directory scope restrictions.
- [ ] **E114-006**: Add command allowlist enforcement with JSON config loading.

### 8.2 Security and operations (Phase 1)

- [ ] **E114-007**: Implement audit logging for all operations.
- [ ] **E114-008**: Add health check and diagnostics endpoints.
- [ ] **E114-009**: Add graceful shutdown and signal handling.
- [ ] **E114-010**: Implement timeout controls and resource limits.

### 8.3 CLI and configuration (Phase 2)

- [ ] **E114-011**: Implement `nexus-agent-local start` command.
- [ ] **E114-012**: Implement `nexus-agent-local config` commands.
- [ ] **E114-013**: Add configuration file loader and defaults.
- [ ] **E114-014**: Create installation and user documentation.

### 8.4 Nexus integration (Phase 2)

- [ ] **E114-015**: Document MCP server registration workflow.
- [ ] **E114-016**: Verify tool discovery and registration in live Nexus instance.
- [ ] **E114-017**: Add example workflows that use local tools.
- [ ] **E114-018**: Test tool execution end-to-end in workflow engine.

### 8.5 Testing and documentation (Phase 2)

- [ ] **E114-019**: Write unit tests for tool handlers and security validators.
- [ ] **E114-020**: Write integration tests for HTTP server and MCP protocol.
- [ ] **E114-021**: Write e2e tests invoking local tools from Nexus workflows.
- [ ] **E114-022**: Write user-facing README with installation, setup, examples.
- [ ] **E114-023**: Add architecture doc explaining design choices and security model.

### 8.6 Follow-up hardening (Phase 3, Future)

- [ ] **E114-024**: Add TLS/mTLS transport support.
- [ ] **E114-025**: Implement JWT auth between Nexus and local service.
- [ ] **E114-026**: Add SSH tunneling support for remote-via-SSH machines.
- [ ] **E114-027**: Implement rate limiting and per-agent quotas.
- [ ] **E114-028**: Add web UI panel for local service status and logs.
- [ ] **E114-029**: Implement structured audit log export and compliance reporting.

---

## 9. Technology Choices

### 9.1 Language and runtime

- **TypeScript + Node.js**: Consistent with rest of codebase, easy distribution via npm.
- **MCP SDK**: Use `@modelcontextprotocol/sdk` (same as api).
- **HTTP Framework**: Express.js for simplicity, or built-in Node http module for minimal deps.

### 9.2 Tool execution

- **child_process.execFile()**: Safe by default (no shell interpretation).
- **fs.promises API**: Modern, promise-based file operations.
- **Timeout enforcement**: Node.js AbortSignal for clean cancellation.

### 9.3 Distribution

- **npm package**: `@nexus-orchestrator/agent-local` published to npm registry.
- **Global CLI**: Support `npm install -g` with a `bin` entry in package.json.
- **Zero external runtime dependency**: No Docker, Python, or other systems required.

---

## 10. Success Criteria

### 10.1 Phase 1 (MVP)

- [ ] Service starts with `nexus-agent-local start` and listens on localhost:3033.
- [ ] MCP tools are discoverable and callable via standard MCP protocol.
- [ ] `exec` tool safely executes commands with allowlist enforcement.
- [ ] File operations (`read`, `write`, `delete`, `list`) work correctly and respect path bounds.
- [ ] All operations are logged and auditable.
- [ ] Health check endpoint responds correctly.
- [ ] Service integrates with existing MCP client runtime without platform changes.

### 10.2 Phase 2 (Integration)

- [ ] Users can register the service via the Nexus web UI or API.
- [ ] Tools appear in Tool Registry with correct metadata and access policies.
- [ ] Workflow steps can invoke local tools and receive results.
- [ ] Agent profiles can declare machine binding and access control.
- [ ] Documentation is clear, examples work end-to-end.
- [ ] E2E tests confirm workflow execution against local service.

### 10.3 Phase 3 (Hardening)

- [ ] TLS/mTLS is supported and configurable.
- [ ] JWT auth protects against unauthorized access.
- [ ] Rate limiting and per-agent quotas are enforced.
- [ ] Web UI shows local service status and diagnostics.
- [ ] Audit logs are structured, exportable, and compliance-ready.

---

## 11. Risk Mitigation

### Risk: Users execute malicious commands
**Mitigation**: 
- Allowlist enforcement is mandatory; empty allowlist denies all commands by default.
- Audit logging is automatic and immutable.
- Agent profiles provide operator-level access control.

### Risk: Path traversal vulnerabilities
**Mitigation**:
- Path validation uses `path.resolve()` and bounds checks against home directory.
- Explicit allowlist for sensitive paths (e.g., `/etc`).
- File operations default to user scope; `/` root is denied without explicit opt-in.

### Risk: DoS via large file operations or long-running commands
**Mitigation**:
- Configurable timeouts (default 30s) with per-tool overrides.
- File size limits with documentation (default 1GB).
- Per-agent resource quotas in follow-up epic.

### Risk: Local service becomes isolated from Nexus updates
**Mitigation**:
- Service pins MCP SDK version to match orchestrator.
- Auto-update checks built into startup.
- Health endpoint includes version info for diagnostics.

---

## 12. Dependencies and Blockers

### 12.1 Required dependencies

1. **EPIC-080** (MCP Client Runtime): Must be completed for HTTP transport and discovery patterns. ✅ Completed 2026-04-12.
2. **EPIC-081** (Plugin SDK): Provides extension patterns; informs local service structure (can proceed in parallel).

### 12.2 Integration touchpoints

1. **MCP Runtime Service** (`apps/api/src/mcp/`): No changes required; local service is a standard MCP server.
2. **Tool Registry** (`apps/api/src/tool/`): No changes required; discovered tools integrate via existing namespace pattern.
3. **Agent Profiles** (`apps/api/src/agent-profile/`): May add optional machine binding metadata (follow-up).
4. **Workflow Engine** (`apps/api/src/orchestration/`): No changes required; tools are invoked via existing step handler.

---

## 13. Backlog and Roadmap

### Phase 1: MVP (Next Sprint)
- [x] Architecture design and tech choices.
- [ ] Skeleton packages/agent-local with HTTP server.
- [ ] MCP tools implementation (exec, file ops).
- [ ] Security validators and allowlist.
- [ ] Basic CLI (start, stop).
- [ ] Unit tests.

### Phase 2: Integration (Sprint +2)
- [ ] CLI configuration and user UX.
- [ ] End-to-end integration with Nexus.
- [ ] Example workflows.
- [ ] E2E test suite.
- [ ] User documentation.

### Phase 3: Hardening (Sprint +4 or later)
- [ ] TLS/mTLS.
- [ ] JWT auth.
- [ ] SSH tunneling.
- [ ] Rate limiting.
- [ ] Web UI panel.
- [ ] Compliance audit logging.

---

## 14. References

- [MCP Specification](https://modelcontextprotocol.io)
- EPIC-080: MCP Client Runtime Integration
- EPIC-081: Plugin SDK and Extension Lifecycle
- [Tool Registry Mechanics](docs/research/tool-registry-mechanics.md)
- [Security Architecture](docs/architecture/security.md)

---

## 15. Questions and Open Items

1. Should MVP allowlist support regex patterns or just literal command prefixes?
   - **Tentative Answer**: Start with simple prefix matching; regex as feature follow-up.

2. Should the service auto-update when Nexus updates the MCP SDK version?
   - **Tentative Answer**: Manual update for MVP (npm update); auto-update as follow-up.

3. Should there be a web UI panel for the local service, or only CLI/API?
   - **Tentative Answer**: CLI and API for MVP; web UI as Phase 3 hardening.

4. Should the service support container-resident operation (e.g., as a sidecar)?
   - **Tentative Answer**: Not in MVP scope; document as future capability.

5. How should users handle secrets (API keys, credentials) passed to commands?
   - **Tentative Answer**: Environment variables are supported; users manage secret storage separately (e.g., .env file).
