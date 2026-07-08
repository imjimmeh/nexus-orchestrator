# Tool Registry Architecture

## Overview

The tool registry uses a discovery-driven approach where capabilities are declared via the `@Capability` decorator on provider methods. At startup, `CapabilityRegistryService` discovers all decorated providers and assembles the capability manifest.

The system manages two distinct tool categories:

1. **Canonical Capabilities**: Declared via `@Capability` decorator on provider methods, registered through `CapabilityRegistryService`
2. **Tool Registry Entries**: Dynamic tools registered through `ToolRegistryService` (includes MCP tools, artifact-based tools, and canonical capabilities projected into the registry)

## Key Components

### Capability Discovery & Registration
- `@Capability` decorator - declares a capability on a provider method with metadata (name, schema, transport, policy tags, tier restriction)
- `CapabilityRegistryService` - discovers all capabilities via NestJS metadata scanner and builds the capability manifest
- `CapabilityContractValidatorService` - validates contracts at startup for consistency
- `CapabilityRegistrarService` - registers canonical capabilities into the tool registry

### Tool Registry & Execution
- `ToolRegistryService` - manages CRUD operations for registered tools in the database
- `ToolCandidateService` - handles tool candidate lifecycle (draft → validation → published)
- `ToolSandboxService` - validates and executes dynamic tool code in isolated environments (Node.js/Python)
- `ToolRuntimeExecutionService` - executes published tools through the sandbox

### Governance & Policy
- `ToolApprovalRuleService` / `ToolPolicyEvaluatorService` - dynamic approval rules with argument pattern matching
- `CapabilityPreflightService` - resolves effective tool permissions for execution contexts
- `WorkflowRuntimeCapabilityExecutorService` - enforces governance at execution time

### MCP Integration
- `McpRuntimeManagerService` - manages external MCP server connections and tool discovery
- `McpRegistryPayload` builder - converts MCP tools into registry entries with namespaced naming

## Adding a New Capability

1. Define Zod schema for the input contract
2. Apply `@Capability` decorator to a provider method:
   ```typescript
   @Capability({
     name: 'my_tool',
     tierRestriction: 1, // 1=LIGHT, 2=HEAVY
     transport: 'runner_local', // 'runner_local', 'api_callback', 'mounted_tool', 'websocket_bridge'
     runtimeOwner: 'runner', // 'runner' or 'api'
     policyTags: ['read_only', 'context'],
     description: 'Tool description',
     inputSchema: MyToolSchema,
   })
   myTool() { return { ok: true }; }
   ```
   *Note: `transport` and `runtimeOwner` are critical for pi-runner to correctly authorize and route tool calls.*
3. Register the provider in its owning module

## Tool Registration Persistence

The `tool_registry` table persists all discovered and dynamic tools. Key columns include:
- `transport`: The communication channel (e.g. `api_callback`).
- `runtime_owner`: The component responsible for execution (e.g. `api`).
- `api_callback`: JSON configuration for HTTP-based tools.
- `typescript_code`: Standard bridge code or dynamic implementation.

## Schema Derivation

Zod → zod-to-json-schema → `CapabilityManifestEntry.schema`

## Validation

- Duplicate names: fails fast at startup
- Bridge action parity: validated against discovered handlers
- Schema derivation failures: fail startup
- Handler/declaration mismatch: validated by `SpecialStepPluginLoaderService` for plugins

### Steering Tools (EPIC-128)

Conversational orchestrator steering uses API-owned steering primitives plus explicit Kanban-owned MCP tools for project state:

| Tool | Mutation | Gating | Tier | Description |
|------|----------|--------|------|-------------|
| `steer_project` | Read-only | — | 2 | Parses user intent into a structured steering plan |
| `amend_entity` | Mutating | Approval-gated | 2 | Direct entity mutation for `work_item`, `work_item_subtask`, `execution` |
| `kanban.project_state` | Read-only | — | Kanban MCP | Queries work items, artifacts, git history, dependencies |

The API-owned entries are implemented as special steps or workflow services and exposed through workflow execution. Kanban-owned state reads are routed to the Kanban MCP server:
- `amend_entity` → `step-amend-entity-special-step.handler.ts` (via special step registry)
- `steer_project` → Workflow run steering service (`WorkflowRunSteeringService`)
- `kanban.project_state` → Kanban MCP tool

All entries respect the standard governance pipeline (preflight → approval rules → execution).

## Tool Governance Architecture

### Execution Flow

1. **Preflight Snapshot** (`CapabilityPreflightService`): Resolves callable, denied, and approval-required tool names from:
   - Agent profile settings (`allowed_tools`, `denied_tools`, `approval_required_tools`)
   - Workflow/job YAML permissions
   - Project mode and dynamic rules (no-payload matching)

2. **Runner Wrapping** (`session-factory.ts` in `pi-runner`):
   - SDK native tools (bash, read, write, edit, ls, find, grep) and mounted tools are wrapped
   - Wrapper calls `POST /api/workflow-runtime/check-permission` with tool payload before execution
   - Respects `_sdk_tool_allowlist.json` written by API for tier-based filtering

3. **Dynamic Rules** (`ToolApprovalRuleService`):
   - Rules stored in `tool_approval_rules` table
   - Match tool name, execution context, and shallow payload fields via `argumentPatterns`
   - Operators: `eq`, `contains`, `glob`, `regex` (top-level payload keys only)
   - Evaluated at execution time for approval-required tools

4. **Blocking & Approvals**:
   - Approval-required tools create `tool_call_approval_requests` rows
   - API blocks execution until human approves, rejects, or request expires
   - Runner receives denial/approval response via governance check

5. **Runner Exceptions**:
   - `nexus_orchestrator` bridge tool uses custom action allowlist (`_nexus_action_allowlist.json`)
   - Direct runner `/execute/command` endpoint is for API-invoked execution, not model-exposed tools
   - Governance can be disabled via `NEXUS_RUNNER_DISABLE_GOVERNANCE_CHECK=true`

### Permission Evaluation Order

1. Static profile/workflow permissions (name-only allow/deny lists)
2. Dynamic rule matching (argument-aware, for approval-required tools only)
3. Human approval workflow (if required and not bypassed by rule)

### Key Limitations

- Profile and workflow permissions are name-only (cannot express "allow bash only when command==ls")
- Workflow YAML does not include `approval_required_tools` field in `IToolPermissionPolicy`
- Argument patterns are shallow (top-level payload keys only, no nested path traversal)
- Argument-aware rules only evaluated for approval-required tools
- Dynamic `allow` rules do not expand beyond static permissions
- No-pattern `deny` rules hide tools at preflight (prevents argument-specific allows)
- Frontend rule editor does not support argument pattern entry (API/database only)
- `nexus_orchestrator` uses action allowlist, not argument-pattern system

## MCP Tool Integration

MCP servers expose tools that are dynamically registered:

1. Server connects → tools discovered via MCP protocol
2. Tools reconciled against Nexus registry (prefix: `mcp_{namespace}_`)
3. Namespaced naming prevents collisions: `mcp_{serverNamespace}_{safeToolName}_{hash}`
4. Tools include API callback metadata for standard execution path
5. MCP tools respect standard governance (preflight, approval rules, sandbox execution)

See `docs/architecture/mcp-integration.md` for details.

## Tool Sandbox Execution

Dynamic tools (artifacts) execute in isolated environments:

- **Languages**: Node.js (`.mjs`) and Python (`.py`)
- **Isolation**: Temporary directory, restricted filesystem access
- **Policy Denials**: Static analysis blocks network, system, and secret access patterns
- **Result Capture**: `__NEXUS_RESULT__` marker in stdout for structured output
- **Timeouts**: 5s (validation), 10s (execution) by default

See `docs/architecture/tool-sandbox.md` for details.

See `docs/architecture/tool-permissions-and-approvals.md` for the full permission model, configuration surfaces, examples, and current limitations.
