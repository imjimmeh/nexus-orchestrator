# Tool Architecture

How agents in the Nexus Orchestrator get access to tools — the registration, execution, and permission models.

## Overview

There are four categories of tools available to agents during execution:

| Category                    | Registration                                                                  | Permission Model                                            | Execution                                        |
| --------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------ |
| **SDK-native coding tools** | Built into `pi-coding-agent` SDK + pi-runner extensions                       | `_sdk_tool_allowlist.json`                                  | Local (in runner container)                      |
| **Bridge tools**            | Passed via `customTools` option at session creation                           | `_nexus_action_allowlist.json` (per action within the tool) | Via WebSocket to orchestrator API                |
| **Mounted DB tools**        | Stored in `tool_registry` DB table, mounted into container                    | Agent profile `allowed_tools` / `denied_tools`              | API callback (HTTP) or runner-local (Playwright) |
| **Extension tools**         | Auto-discovered `.ts` files in `~/.pi/agent/extensions/` or `.pi/extensions/` | pi-agent SDK-level registration                             | Local (in runner process)                        |

---

## 1. SDK-native Coding Tools

These are the core filesystem and shell tools that the pi-agent SDK provides. They execute directly in the runner container.

**Currently registered tools:**

| Tool    | Source                                                     |
| ------- | ---------------------------------------------------------- |
| `read`  | `createCodingTools()` from `@mariozechner/pi-coding-agent` |
| `write` | `createCodingTools()` from `@mariozechner/pi-coding-agent` |
| `edit`  | `createCodingTools()` from `@mariozechner/pi-coding-agent` |
| `bash`  | `createCodingTools()` from `@mariozechner/pi-coding-agent` |
| `ls`    | `createCodingTools()` from `@mariozechner/pi-coding-agent` |
| `find`  | `createCodingTools()` from `@mariozechner/pi-coding-agent` |
| `grep`  | `createCodingTools()` from `@mariozechner/pi-coding-agent` |

**Registration flow:**

```
API side (step-agent-container-support.service.ts):
  SDK_CODING_TOOLS = ['read', 'write', 'edit', 'bash', 'ls', 'find', 'grep']
       ↓ filter through job.tools, workflow permissions, profile auth
  writeSdkToolAllowlist() → _sdk_tool_allowlist.json

Runner side (session-factory.ts):
  createCodingTools(cwd)                      → [read, bash, write, edit, ls, find, grep]
  applyHostMountScopeGuards()                 → wraps read/write with path checks
  read _sdk_tool_allowlist.json               → filters to only allowed names
  expandSdkAllowlistNames()                   → grants find/grep when read+ls are allowed
```

**Key file:** `packages/pi-runner/src/session/session-factory.ts:resolveCodingTools()`

**Permission model:**

1. **Workflow YAML `allow_tools`**: Per-step tool restriction (highest-level control)
2. **Job `tools`**: Per-job tool restriction
3. **Workflow permissions policy**: `allow`/`deny` rules at workflow level
4. **Job permissions policy**: `allow`/`deny` rules at job level
5. **Agent profile `allowed_tools` / `denied_tools`**: Per-agent profile restrictions
6. **Host mount scope**: `_host_mount_scope.json` restricts which paths `read`/`write` can access

The API resolves all these layers in `resolveAllowedSdkCodingToolsForAgent()` (`step-agent-container-support.helpers.ts:22`), producing the final allowlist written to `_sdk_tool_allowlist.json`.

### Adding a new SDK-native tool

1. Prefer the Pi SDK implementation if the SDK already ships the tool.
2. If Nexus must provide a local implementation, build a `ToolDefinition` directly or use the `NexusTool` class for Zod validation.
3. Wire the tool into `resolveCodingTools()` in `session-factory.ts`.
4. Add the tool name to the API-side SDK-native tool list in `CapabilityPreflightService` and seed validation helpers.
5. Add policy and prompt coverage in seed agent profiles and workflow YAMLs.

**Important:** SDK-native tools are filtered by `_sdk_tool_allowlist.json` (unlike bridge tools). This means even if a tool exists in code, it will not be presented to an agent unless the API explicitly allows it via the allowlist.

---

## 2. Bridge Tools

Bridge tools communicate with the Nexus orchestrator over the WebSocket connection. They are registered as `customTools` at session creation.

`nexus_orchestrator` is intentionally **co-managed**:

- The API exposes it through `@Capability` in `nexus-orchestrator-capability.provider.ts` with `runtimeOwner: 'runner'` and `seedInRegistry: false`; this is the policy, approval, and capability-declaration surface.
- `pi-runner` owns the concrete `ToolDefinition` in `orchestrator-tool.ts` and dispatches each allowed action to the API via `client.emit()`/`waitForCommand()`.
- The API writes per-step action permissions to `_nexus_action_allowlist.json`; `orchestrator-dispatch.ts` in runner enforces those at execution time.

**Currently registered tools:**

| Tool                 | Purpose                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- |
| `nexus_orchestrator` | Multiplex tool for 21+ orchestrator actions (spawn subagent, update kanban, war room ops, step_complete, etc.) |
| `ask_user_questions` | Poses questions to the human user and blocks for a response                                                    |

**Registration flow:**

```
Runner side (server.ts):
  executeAgentStep()
    ├─ readNexusActionAllowlist()   → _nexus_action_allowlist.json
    ├─ createNexusBridgeTools(client, {allowedActions})
    │    ├─ nexus_orchestrator       (filtered per-action by allowedActions)
    │    └─ ask_user_questions       (not filtered)
    └─ createNexusSession(envConfig, runnerConfig, {customTools: bridgeTools})
         └─ createAgentSession({customTools})
```

**Key file:** `packages/pi-runner/src/tools/nexus-bridge-tools.ts`

**Permission model:**

Bridge tools are **not** filtered by `_sdk_tool_allowlist.json`. Instead, the `nexus_orchestrator` tool has per-action filtering via `_nexus_action_allowlist.json`:

1. API resolves allowed nexus actions from workflow + job permissions
2. Writes `_nexus_action_allowlist.json` to the container mount directory
3. Runner reads it via `readNexusActionAllowlist()` and passes to `createNexusBridgeTools({allowedActions})`
4. The `nexus_orchestrator` tool checks `allowedActions` before executing each action (`orchestrator-dispatch.ts:20`)

The `ask_user_questions` tool has no action-level filtering but is always provided to agents.

### Adding a new bridge tool

1. Create a factory function in `packages/pi-runner/src/tools/<tool-name>/`
2. Use the `NexusTool` class pattern (Zod schema → handler → `toToolDefinition()`)
3. If it goes through the orchestrator bridge, use `client.emit()` / `client.waitForCommand()`
4. Add it to the returned array in `createNexusBridgeTools()`

---

## 3. Mounted DB Tools

Tools registered in the `tool_registry` database table, mounted into the container at runtime.

**Registration flow:**

```
API side (tool-mounting.service.ts):
  prepareToolMount(mountKey, tools)
    ├─ Reads tools from tool_registry DB table
    ├─ Checks agent profile authorization (canProfileUseTool)
    ├─ Wraps TypeScript code with metadata export
    └─ Writes .ts files to /tmp/nexus-tools/<mountKey>/

  Container provisioning:
    Mounts /tmp/nexus-tools/<mountKey>/ → /opt/pi-runner/extensions/

Runner side (session-factory.ts):
  loadMountedToolDefinitions(extensionsDir)
    ├─ Reads .ts files from extensions directory
    ├─ Parses export const metadata = {...} from each file
    └─ Creates ToolDefinition with execute function
        ├─ prepareArguments()         → pre-SDK-validation argument normalization
        ├─ SDK schema validation      → validates ToolDefinition.parameters
        ├─ transport="api_callback"  → HTTP call to Nexus API
        ├─ transport="runner_local"  → Playwright browser handlers
        └─ (otherwise)               → Lightweight stub
```

**Key files:**

- `apps/api/src/tool/tool-mounting.service.ts` — API-side mounting
- `packages/pi-runner/src/session/session-factory.ts:loadMountedToolDefinitions()` — Runner-side loading
- `apps/api/src/tool/tool-registry.service.ts` — DB management

**Permission model:**

Mounted tools are **not** filtered by `_sdk_tool_allowlist.json`. Authorization happens at mount time:

1. **Agent profile `allowed_tools` / `denied_tools`**: Checked in `ToolMountingService.canProfileUseTool()`
2. **IAM policy**: Integrated via `IAMPolicyService` + `PolicyEngineService`
3. If a tool fails authorization, `prepareToolMount()` throws `ForbiddenException`

### Adding a new mounted tool

1. Insert into `tool_registry` DB table with `name`, `schema`, `typescript_code`, `tier_restriction`
2. Set `runtime_owner` (`api` or `runner`) and `transport` (`api_callback` or `runner_local`)
3. If `transport="api_callback"`, provide `api_callback` metadata (HTTP method, path template, body mapping)
4. Authorize it in seed agent profiles (`allowed_tools` array in `agent.json`)

---

## 4. Extension Tools

Standard pi-agent extension tools registered via `pi.registerTool()`. These are loaded from the pi-agent SDK's extension autodiscovery.

**Locations:**

- `~/.pi/agent/extensions/*.ts` (global)
- `.pi/extensions/*.ts` (project-local)
- The container mount path: `/opt/pi-runner/.pi/agent/extensions/` (runtime)

These follow the standard pi-agent extension lifecycle (see `pi-agent-extensions.md` for details). The Nexus Orchestrator does not add additional permission layers on top of the pi-agent SDK's own tool registration.

---

## Tool Resolution at Runtime

When an agent turn begins, the active tool set is determined by:

```
createAgentSession({tools, customTools})
  ├─ codingTools (from resolveCodingTools) → "tools" parameter
  │    └─ filtered by _sdk_tool_allowlist.json + host mount scope
  ├─ customTools (bridge tools + mounted DB tools)
  │    └─ always active, not filtered by SDK allowlist
  └─ extension tools (from pi-agent autodiscovery)
       └─ registered via pi.registerTool() during extension loading
```

The pi-agent SDK's `_refreshToolRegistry()` resolves the final tool set:

1. All built-in tool definitions go into the registry
2. Custom tools are wrapped and added
3. `activeToolNames` (from the `tools` parameter) determines which built-in tools are active
4. New custom tools are auto-added to the active set

---

## Tool Call Execution and Validation Flow

Tool calls cross three boundaries: model output, runner execution, and API handling. Each boundary validates a different contract.

```text
Agent model response
  -> Pi SDK tool-call parser
  -> ToolDefinition.prepareArguments(rawArgs)
  -> Pi SDK JSON Schema validation against ToolDefinition.parameters
  -> ToolDefinition.execute(toolCallId, preparedArgs)
  -> pi-runner transport handling
  -> Nexus API endpoint validation
  -> API service/domain validation and persistence
```

The SDK validates arguments before `execute()` runs. Any compatibility normalization needed for model-produced argument shapes must therefore happen in `prepareArguments`, not only inside `execute()`.

### Mounted API Callback Tools

Mounted DB tools use `loadMountedToolDefinitions()` in `packages/pi-runner/src/session/mounted-tools.ts`.

For `api_callback` tools, the runtime order is:

1. The SDK passes raw model arguments to `prepareArguments`.
2. `prepareArguments` recursively parses object- or array-looking JSON strings into native values.
3. The SDK validates the prepared args against `metadata.schema` / `ToolDefinition.parameters`.
4. `execute()` applies the same normalization again as defense in depth.
5. `createToolParamsValidator()` runs AJV validation before the HTTP callback.
6. `executeApiCallback()` resolves path params and builds the request body.
7. `buildCallbackBody()` applies `api_callback.body_mapping` and parses JSON-looking mapped strings.
8. The API controller validates the HTTP body with Zod.
9. The API service applies domain validation and persists or rejects the result.

This layered validation is intentional. SDK validation protects the agent loop from malformed tool calls. Runner validation protects the transport contract. API validation protects workflow state.

### `set_job_output` Example

`set_job_output` is a mounted `api_callback` tool declared by `JobOutputCapabilityProvider`.

Its public tool schema is:

```json
{
  "type": "object",
  "required": ["data"],
  "properties": {
    "data": { "type": "object" }
  }
}
```

The valid tool-call shape is a native object under `data`:

```json
{
  "data": {
    "summary": "Finished work item review.",
    "work_item_specs_changed": true,
    "work_item_spec_paths": ["docs/work-items/example.md"]
  }
}
```

The invalid shape is a string containing JSON:

```json
{
  "data": "{\"summary\":\"Finished work item review.\"}"
}
```

Without `prepareArguments`, the SDK rejects the second shape before runner `execute()` can normalize it. With `prepareArguments`, the runner converts `data` to a native object before SDK validation.

After validation, `api_callback.body_mapping` sends `data` to `POST /api/workflow-runtime/jobs/set-output`. The controller requires `data` to be a record, and `WorkflowRuntimeSetJobOutputService` rejects nulls, arrays, reserved keys, and fabricated hydration summaries before merging into `jobs.{jobId}.output`.

### `step_complete` and Output Contracts

`step_complete` does not persist job output. It asks the API to complete the step.

Before allowing completion, `WorkflowStepCompletionGuardService` validates the current `jobs.{jobId}.output` against the job's `output_contract`. Agents must call `set_job_output`, wait for the success response, then call `step_complete`.

For output-contract jobs, repeated `step_complete` failures usually mean either the agent has not called `set_job_output`, or `set_job_output` failed validation and never persisted the required fields.

---

## Permission Layers Summary

| Layer                          | Applies to                       | Defined in                     | Enforced by                                                         |
| ------------------------------ | -------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| Workflow YAML `allow_tools`    | All tools per step               | Workflow YAML                  | API → `_sdk_tool_allowlist.json` + `_nexus_action_allowlist.json`   |
| Job `tools`                    | SDK coding tools                 | Job definition                 | API → `_sdk_tool_allowlist.json`                                    |
| Workflow permissions           | SDK coding tools + nexus actions | Workflow YAML permissions      | API → allowlists                                                    |
| Job permissions                | SDK coding tools + nexus actions | Job definition permissions     | API → allowlists                                                    |
| Agent profile `allowed_tools`  | All tool types                   | `agent.json`                   | `ToolMountingService.canProfileUseTool()` + SDK allowlist filtering |
| `_sdk_tool_allowlist.json`     | SDK-native coding tools          | Written by API, read by runner | `resolveCodingTools()` in runner                                    |
| `_nexus_action_allowlist.json` | Nexus orchestrator actions       | Written by API, read by runner | `orchestrator-dispatch.ts` in runner                                |
| `_host_mount_scope.json`       | `read`/`write` tool paths        | Written by API, read by runner | `host-mount-scope.ts` guard in runner                               |
| IAM policy engine              | Mounted DB tools                 | `iam_policies` DB              | `ToolMountingService.prepareToolMount()`                            |

---

## Key Files Reference

| File                                                                        | Role                                                                             |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `packages/pi-runner/src/session/session-factory.ts`                         | Assembles coding tools, mounted tools, bridge tools; applies allowlist filtering |
| `packages/pi-runner/src/session/read-fallback.ts`                           | EISDIR fallback: delegates `read` on a directory to `ls`                         |
| `packages/pi-runner/src/tools/nexus-bridge-tools.ts`                        | Creates bridge tools (`nexus_orchestrator`, `ask_user_questions`)                |
| `packages/pi-runner/src/tools/orchestrator/orchestrator-tool.ts`            | Runner-owned `nexus_orchestrator` `ToolDefinition`                               |
| `packages/pi-runner/src/tools/orchestrator/orchestrator-dispatch.ts`        | Enforces scoped `nexus_orchestrator` actions from `_nexus_action_allowlist.json` |
| `packages/pi-runner/src/tools/tool-builder.ts`                              | `NexusTool` class: Zod schema → `ToolDefinition` with validation                 |
| `packages/pi-runner/src/server/server.ts`                                   | Entry point: creates bridge tools, reads action allowlist, creates session       |
| `apps/api/src/workflow/providers/nexus-orchestrator-capability.provider.ts` | API-owned capability contract and policy marker for `nexus_orchestrator`         |
| `apps/api/src/workflow/step-agent-container-support.service.ts`             | API-side: resolves allowed tools, writes runtime manifests                       |
| `apps/api/src/workflow/step-agent-container-support.helpers.ts`             | `resolveAllowedSdkCodingToolsForAgent()`: multi-layer permission resolution      |
| `apps/api/src/tool/tool-mounting.service.ts`                                | Prepares mounted tool files, writes allowlists and scope manifests               |
| `apps/api/src/tool/tool-registry.service.ts`                                | DB CRUD for `tool_registry` table                                                |
| `seed/agents/*/agent.json`                                                  | Agent profile tool configurations                                                |
| `seed/workflows/*.workflow.yaml`                                            | Workflow-level `allow_tools` definitions                                         |
