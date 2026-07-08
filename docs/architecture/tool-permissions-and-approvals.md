# Tool Permissions And Approvals

**Status:** Current as of 2026-06-04 (EPIC-159 ratified)
**Domain:** Agent Capabilities / Runner Governance / Human Approval

## Summary

Nexus has two related but different tool governance mechanisms:

- **Static tool permissions** decide which tool names an agent can see or call. These are configured on agent profiles and workflow/job YAML. They do not inspect tool arguments.
- **Dynamic approval rules** can inspect tool arguments. They are evaluated by the API governance endpoint and can allow, deny, or require human approval for a specific call payload, but argument-aware rules only run at execution time for tools that are already classified as approval-required.

**Note:** EPIC-159 delivered **Unified Tool Policy**, which is now the canonical tool permission model. `IToolPermissionPolicy` supports `tool_policy` and `approval_required_tools`, preflight defers to execution when argument-aware rules exist, and spawn_subagent is gated via argument matching. See [Tool Policy System Guide](../guide/36-tool-policy.md) and [Unified Tool Policy Developer Guide](../guides/unified-tool-policy.md).

## Static Permission Settings

### Agent Profiles

Agent profiles persist a unified `tool_policy` JSON block of type `ToolPolicyDocument` in the `agent_profiles` table.

This field is defined in `packages/core/src/schemas/ai-config/profiles.schema.ts` and persisted by `apps/api/src/ai-config/database/entities/agent-profile.entity.ts`.

Frontend configuration is available on the agent profile editor (`apps/web/src/pages/agents/AgentProfileForm.fields.tsx`). Each registered tool is rendered with these choices:

- `None`
- `Allowed`
- `Denied`
- `Req. Approval`

The profile UI is name-only. It does not expose argument patterns.

### Workflow And Job YAML

Workflow definitions and jobs accept `permissions` objects:

```yaml
permissions:
  policy_strategy: layered
  tool_policy:
    default: deny
    rules:
      - allow read *
      - allow ls *
      - allow bash *
```

The contract is `IToolPermissionPolicy` in `packages/core/src/interfaces/workflow-legacy.types.ts`:

- `policy_strategy`: `layered` or `profile_only`
- `tool_policy` — canonical `ToolPolicyDocument`
- `allow_host_mounts`
- `deny_host_mounts`
- `allow_host_mount_rw`

### Effective Static Allowlist

At step preflight, `CapabilityPreflightService` builds a capability snapshot:

1. Gathers candidate registered tools and runner-native tools for the job tier
2. `StepSupportService.resolveAllowedToolNames()` resolves profile allowed/denied permissions from the `tool_policy`
3. Workflow-level `permissions` are layered unless `policy_strategy: profile_only`
4. Job-level `permissions` are layered last
5. If an agent profile is present, the final set is intersected with the profile-allowed set (workflow YAML cannot expand beyond the profile)

The result is written into the runtime capability snapshot as:

- `callable_tools`
- `approval_required_tools`
- `denied_tools`

## Dynamic Tool Approval Rules

Dynamic rules are stored in `tool_approval_rules` and managed by `ToolApprovalRuleService`.

Rule shape:

```json
{
  "scopeType": "global",
  "scopeId": null,
  "toolName": "bash",
  "effect": "allow",
  "priority": 200,
  "argumentPatterns": [
    { "path": "command", "operator": "eq", "value": "ls" }
  ]
}
```

Supported scopes:

- `global`
- `project`
- `agent_profile`
- `workflow_run`
- `chat_session`

Supported effects:

- `allow`
- `deny`
- `require_approval`

Supported argument operators:

- `eq`
- `contains`
- `glob`
- `regex`

**Argument matching is shallow.** `path` is looked up as `payload[path]`; dotted paths like `command.args[0]` are not traversed.

Rules are sorted by scope specificity, then by descending priority. The first matching rule wins.

## API Configuration

Dynamic rules can be created through the admin API:

```http
POST /api/tool-approval-rules
Authorization: Bearer <admin-or-developer-token>
Content-Type: application/json
```

```json
{
  "scopeType": "global",
  "scopeId": null,
  "toolName": "bash",
  "effect": "allow",
  "priority": 200,
  "argumentPatterns": [
    { "path": "command", "operator": "eq", "value": "ls" }
  ]
}
```

The controller is `apps/api/src/capability-governance/tool-approval-rules.controller.ts`.

## Frontend Configuration

The frontend settings page has `ToolApprovalRulesCard`, which can list, create, edit, and delete dynamic rules by:

- tool name
- effect
- scope
- scope ID
- priority
- expiry

**Current frontend gaps:**

- It does not render or edit `argumentPatterns`, even though the API and frontend types support them.
- Its scope dropdown uses stale values `workflow` and `session`; the backend expects `workflow_run` and `chat_session`.
- The admin client has methods for pending tool-call approval requests, but there is not a dedicated visible runtime tool-call approval queue component wired to those methods.

As a result, argument-based rules currently need to be created through the API or database tooling rather than the visible settings card.

## Execution-Time Enforcement

### Runner SDK Tools

Runner-native SDK tools such as `bash`, `read`, `write`, `edit`, `ls`, `find`, and `grep` are filtered and wrapped in `packages/pi-runner/src/session/session-factory.ts`.

There are two layers:

1. The API writes `_sdk_tool_allowlist.json` into the mounted extensions directory. The runner reads this file and only exposes allowlisted SDK-native tools to the agent session.
2. The runner wraps exposed SDK and mounted tools with a governance check. Before execution, it calls `POST /api/workflow-runtime/check-permission` with:

```json
{
  "tool_name": "bash",
  "payload": { "command": "ls" },
  "workflow_run_id": "...",
  "job_id": "..."
}
```

If the API returns `denied`, the runner returns a denial result to the model and does not execute the tool. For approval-required tools, the API is expected to block until approval, rejection, or expiry.

Governance wrapping can be disabled by setting `NEXUS_RUNNER_DISABLE_GOVERNANCE_CHECK=true` in the runner environment.

### Mounted API Callback And Runner-Local Tools

Registered tools mounted into the runner are also wrapped by the same runner governance check.

- `transport: "api_callback"` tools validate locally and then call back to the API for execution.
- `transport: "runner_local"` tools execute locally in the runner after the wrapper permits them.

### Nexus Bridge Tool

`nexus_orchestrator` and `ask_user_questions` are passed as custom bridge tools. They are not wrapped by the generic `/check-permission` wrapper in `session-factory.ts`.

`nexus_orchestrator` has its own action allowlist:

- The API writes `_nexus_action_allowlist.json`.
- The runner reads it when creating bridge tools.
- `createNexusOrchestratorTool()` and `executeNexusOrchestratorAction()` reject actions not in the allowlist.

This is action-name gating, not general argument-pattern governance.

### Direct Runner Command Endpoint

`packages/pi-runner/src/server/server.ts` exposes an `/execute/command` server path that runs shell commands directly for API-invoked command execution. This is not a model-exposed tool path and does not go through the generic tool governance wrapper.

## How Argument-Based Approval Works

There are two evaluation moments.

### Preflight

Preflight has tool names and context, but no actual tool arguments. Rules with `argumentPatterns` do not match during preflight. However, preflight **defers to execution** when argument-aware rules exist — it no longer removes the tool from the callable set just because a no-pattern deny rule exists alongside argument-aware allow rules.

No-pattern dynamic rules still affect preflight:

- `deny` removes the tool from the callable set.
- `require_approval` puts the tool into `approval_required_tools`.
- `allow` does not expand beyond profile/workflow static permissions.

### Execution

At execution time, the actual payload is available. Argument-pattern rules are evaluated in `WorkflowRuntimeCapabilityExecutorService` for **all** callable tools — not only those in `approval_required_tools`. A rule can promote `allow` to `require_approval` (e.g., "allow bash, but require approval for `rm`"), promote `allow` to `deny` (e.g., "allow bash, but deny `rm -rf`"), or downgrade `require_approval` to `allow` (e.g., "require approval for bash, but allow `ls`").

## Example: Allow `bash` For `ls`, Approve Everything Else

First, make `bash` approval-required. The preferred current configuration is on the agent profile:

```json
{
  "allowed_tools": ["read", "ls", "bash"],
  "approval_required_tools": ["bash"]
}
```

Then add a higher-priority dynamic allow rule for the safe payload:

```json
{
  "scopeType": "agent_profile",
  "scopeId": "developer-agent",
  "toolName": "bash",
  "effect": "allow",
  "priority": 200,
  "argumentPatterns": [
    { "path": "command", "operator": "eq", "value": "ls" }
  ]
}
```

Runtime behavior:

- `bash({ "command": "ls" })` is allowed without human approval.
- `bash({ "command": "npm test" })` creates a tool-call approval request and blocks until approved, rejected, or expired.

## Example: Allow `ls`, Deny Dangerous Commands, Approve The Rest

Keep `bash` approval-required and add these dynamic rules:

```json
[
  {
    "scopeType": "agent_profile",
    "scopeId": "developer-agent",
    "toolName": "bash",
    "effect": "allow",
    "priority": 300,
    "argumentPatterns": [
      { "path": "command", "operator": "eq", "value": "ls" }
    ]
  },
  {
    "scopeType": "agent_profile",
    "scopeId": "developer-agent",
    "toolName": "bash",
    "effect": "deny",
    "priority": 250,
    "argumentPatterns": [
      { "path": "command", "operator": "regex", "value": "(^|[;&|]\\s*)rm\\s+-rf" }
    ]
  }
]
```

Runtime behavior:

- `ls` is allowed.
- matching `rm -rf` commands are denied.
- other commands require human approval because the profile marks `bash` as approval-required.

Do not add a no-pattern fallback `deny` rule for `bash` if you still want safe argument-specific calls to be usable. A no-pattern `deny` matches at preflight and removes `bash` from the callable tool set before any payload exists.

## Current Limitations

- Argument patterns are shallow (top-level payload key matches only; dotted paths like `command.args[0]` are not traversed).
- Dynamic `allow` rules do not expand static permissions. The tool must still be allowed by profile/workflow policy.
- The visible frontend rule editor does not support argument pattern entry yet (the API and frontend types support `argumentPatterns`, but the settings card UI does not render or edit them).
- Agent profile UI does not provide a `tool_policy` structured/JSON editor (editing requires direct DB or API access).
- The direct runner command endpoint (`/execute/command`) is outside model tool governance.
- `nexus_orchestrator` uses custom action allowlist enforcement rather than the generic argument-pattern system.

## Key Files

- `packages/core/src/interfaces/workflow-legacy.types.ts`
- `packages/core/src/schemas/ai-config/profiles.schema.ts`
- `apps/api/src/database/entities/agent-profile.entity.ts`
- `apps/api/src/capability-governance/tool-approval-rule.service.ts`
- `apps/api/src/capability-governance/tool-approval-rules.controller.ts`
- `apps/api/src/capability-governance/tool-call-approval-request.service.ts`
- `apps/api/src/tool/capability-preflight.service.ts`
- `apps/api/src/workflow/workflow-runtime/workflow-runtime-capability-executor.service.ts`
- `apps/api/src/workflow/workflow-step-execution/step-support.service.ts`
- `packages/pi-runner/src/session/session-factory.ts`
- `packages/pi-runner/src/tools/orchestrator/orchestrator-tool.ts`
- `apps/web/src/pages/agents/AgentProfileForm.fields.tsx`
- `apps/web/src/pages/settings/ToolApprovalRulesCard.tsx`