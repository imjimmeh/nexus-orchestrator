# Agent Capability Orchestration

This document describes the implementation delivered under EPIC-017 for:

- hierarchical tool permissions (agent/workflow/step),
- reusable tool lifecycle in workflows,
- workflow-to-workflow execution.

## 1) Hierarchical permissions

Tool access is resolved at runtime in this order:

1. Agent profile default (`agent_profiles.allowed_tools`)
2. Workflow-level policy (`permissions` at workflow root)
3. Step-level policy (`steps[].permissions`)

Step-level policy can broaden or narrow previous scopes.

### Workflow-level YAML

```yaml
permissions:
  allow_tools: [read_file, write_file]
  deny_tools: [bash]
```

### Step-level YAML

```yaml
steps:
  - id: secure_review
    type: review
    tier: light
    permissions:
      allow_tools: [query_memory]
      deny_tools: []
```

## 2) Agent-level permissions

Agent profiles now support `allowed_tools` and can be managed through:

- API: `/ai-config/agent-profiles`
- Web: `Agents` page (Allowed Tools field)

Example payload:

```json
{
  "name": "qa_automation",
  "allowed_tools": ["read_file", "bash", "query_memory"]
}
```

Use `"*"` to allow all mounted tools for that profile.

## 3) Reusable tools in workflows

### Register a tool from a workflow step

Use `register_tool` step type:

```yaml
- id: create_custom_tool
  type: register_tool
  tier: light
  inputs:
    name: custom_tool
    tier_restriction: 1
    schema:
      type: object
      properties:
        message:
          type: string
      required: [message]
    typescript_code: |
      export const tool = {
        execute: async (params: { message: string }) => {
          return { ok: true, echo: params.message };
        }
      };
```

The tool is persisted in the registry and can be reused by later workflow runs.

### Manage tools in UI

A dedicated `Tools` page exists in the web app for create/update/delete.

## 4) Workflow-to-workflow execution

Use `invoke_workflow` step type:

```yaml
- id: run_child
  type: invoke_workflow
  tier: heavy
  workflow_id: child_workflow_id
  wait_for_completion: true
  inputs:
    note: "Run child workflow now"
```

Behavior:

- If `wait_for_completion` is true (default), parent step waits and captures child state.
- If `wait_for_completion` is false, parent step proceeds after child run starts.

Validation guarantees:

- `invoke_workflow` requires `workflow_id` (or `inputs.workflow_id`).
- Self-invocation (`workflow_id == current workflow_id`) is rejected.

## 5) Backend touchpoints

- `apps/api/src/workflow/step-execution.consumer.ts`
- `apps/api/src/workflow/workflow-validation.service.ts`
- `apps/api/src/tool/tool.controller.ts`
- `apps/api/src/tool/tool-registry.service.ts`
- `apps/api/src/database/entities/agent-profile.entity.ts`
- `packages/core/src/interfaces/index.ts`

## 6) Runtime lifecycle capabilities (EPIC-098)

Non-kanban chat agents now execute tool and skill lifecycle mutations through
workflow-runtime endpoints instead of direct admin-only routes.

Tool lifecycle runtime endpoints:

- `POST /api/workflow-runtime/tools/candidates`
- `POST /api/workflow-runtime/tools/candidates/:artifactId/validate`
- `POST /api/workflow-runtime/tools/candidates/:artifactId/publish`
- `POST /api/workflow-runtime/tools/upsert`

Skill lifecycle runtime endpoints:

- `POST /api/workflow-runtime/skills`
- `PATCH /api/workflow-runtime/skills/:skillId`
- `POST /api/workflow-runtime/skills/:skillId/files/list`
- `PUT /api/workflow-runtime/skills/:skillId/files`
- `DELETE /api/workflow-runtime/skills/:skillId/files`
- `PUT /api/workflow-runtime/profiles/:profileId/skills`

Governance and audit behavior:

1. Calls resolve run/job execution context from explicit inputs or agent token.
2. Capability preflight determines callable, denied, and approval-required state.
3. Denied and approval-required operations return explicit runtime outcomes.
4. Lifecycle events emit attempt, success, denied, and failure records to event ledger.

## 7) Tests

Current coverage additions:

- `apps/api/src/workflow/step-execution.consumer.spec.ts`
  - invoke workflow success path
  - register tool path
  - input template resolution
- `apps/api/src/workflow/workflow-validation.service.spec.ts`
  - invoke workflow validation
  - register tool validation
  - permissions shape validation

Run with:

```bash
npm run test:unit --workspace=apps/api -- src/workflow/step-execution.consumer.spec.ts src/workflow/workflow-validation.service.spec.ts
```
