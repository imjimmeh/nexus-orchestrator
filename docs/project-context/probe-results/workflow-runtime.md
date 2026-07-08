---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: workflow-runtime
outcome: success
inferred_status: implemented
confidence_score: 0.90
evidence_refs:
  - apps/api/src/workflow/workflow-runtime/workflow-runtime.module.ts
  - apps/api/src/workflow/workflow-runtime/workflow-runtime-tools.service.ts
  - apps/api/src/workflow/workflow-runtime/workflow-runtime-capability-executor.service.ts
  - apps/api/src/workflow/workflow-runtime/workflow-runtime-orchestration-actions.service.ts
  - apps/api/src/workflow/workflow-runtime/workflow-runtime-lifecycle.controller.ts
  - apps/api/src/tool-runtime/tool-runtime.module.ts
  - apps/api/src/tool-runtime/tool-runtime-execution.service.ts
  - apps/api/src/tool-registry/tool-registry.module.ts
source_paths:
  - apps/api/src/workflow/workflow-runtime
  - apps/api/src/tool-runtime
  - apps/api/src/tool-registry
updated_at: 2026-06-02T00:00:00.000Z
---

# Probe Result: Workflow Runtime and Agent Interface

## Narrative Summary

The **Workflow Runtime and Agent Interface** probe scope is **robustly implemented** across all three assigned paths. The codebase demonstrates a mature, layered architecture with clear separation between capability governance, tool registry/discovery, tool runtime execution, and agent-delegation primitives.

**workflow-runtime** (apps/api/src/workflow/workflow-runtime) surfaces a comprehensive HTTP controller (`WorkflowRuntimeLifecycleController`) exposing capability queries, internal tool execution, set_job_output, agent profile management, and subagent orchestration. The `WorkflowRuntimeToolsService` handles capability resolution for workflow, subagent, and chat contexts, integrating with `CapabilityPreflightService` for snapshot-based governance lookups. The `WorkflowRuntimeCapabilityExecutorService` enforces governance policies (deny/approval_required) and audit events. Subagent spawning and coordination use Docker container APIs. The `WorkflowRuntimeOrchestrationActionsService` provides the `invoke_agent_workflow` action with deduplication, scope resolution, and error categorization.

**tool-runtime** (apps/api/src/tool-runtime) provides tool candidate lifecycle (draft→validate→publish), sandbox-based execution, tool/tool mounting to temporary filesystems, and skill mounting. Notable is the `ToolContractRepairAdapter` which auto-repairs malformed payloads (JSON strings, field aliases) with threshold-based runtime feedback ingestion.

**tool-registry** (apps/api/src/tool-registry) provides the canonical storage layer: `ToolRegistryService` for CRUD/upsert, `CapabilityRegistrarService` for canonical capability registration with conflict detection, `ToolCatalogService`, `ToolTierPolicyService`, and `ToolValidationService` for TypeScript/JSON Schema validation.

Test coverage is comprehensive: 15 spec files in workflow-runtime (capability executor, lifecycle controller, orchestration actions, subagent tools, terminal run guard, tools service, etc.), 2 spec files in tool-runtime, 1 in tool-registry.

## Capability Updates

### Workflow Runtime Agent Interface
- **`GET /workflow-runtime/get-capabilities`** — Resolves capabilities across three contexts: subagent (via `resolveSubagentCapabilitiesIfApplicable`), chat session, and workflow run. Returns `callable_tools`, `denied_tools`, `approval_required_tools`, `agent_tool_policy`, `required_next_action`, `standing_orders`. Backed by `CapabilityPreflightService.resolveCapabilitySnapshot`.
- **`GET /workflow-runtime/get-agent-profiles`** — Paginated listing of agent profiles with full metadata summaries.
- **`GET /workflow-runtime/get-agent-profile`** — Single profile lookup by name.
- **`GET /workflow-runtime/list-agent-profile-names`** — Lightweight name-only listing.
- **`POST /workflow-runtime/orchestration/invoke-agent-workflow`** — Launches a Core workflow as an agent delegation target. Handles `workflow_not_found` and `workflow_concurrency_skip` as structured error outcomes with suggested fixes.
- **`POST /workflow-runtime/check-permission`** — Pre-flight governance check before tool invocation.
- **`POST /workflow-runtime/set-job-output`** — Persists structured job output merged against output_contract.
- **`POST /workflow-runtime/yield-session`** — Finalizes orchestration session outcome.
- **`POST /workflow-runtime/update-orchestration-state`** — Partial state patch for orchestration session.
- **`POST /workflow-runtime/query-memory`** / **`record-learning`** / **`get-todo-list`** / **`manage-todo-list`** — Internal tool wrappers routed through `executeInternalTool`.

### Capability Lifecycle (Skill & Tool Artifact Management)
- Tool candidates: create draft → validate (sandbox execution) → publish (activates + upserts to registry).
- Skills: create/update/upsert, profile skill assignment, `save_script_as_skill`.
- Artifacts: create/list/upsert/delete artifact files, `save_script_as_artifact`.
- Runtime capability contract definitions (`WORKFLOW_RUNTIME_CAPABILITY_DEFINITIONS`) exposed at `workflow-runtime-capability.contracts.ts` for `get_todo_list`, `query_memory`, `record_learning`, `manage_todo_list`, `list_schedules`.

### Subagent Primitives
- `spawn_subagent_async` — Docker container spawn linked to parent workflow run + job.
- `wait_for_subagents` — Coordination wait with timeout.
- `check_subagent_status` — Live status inspection against Docker API.
- Companion tool auto-injection (e.g., `wait_for_subagents` added when `spawn_subagent_async` is present).

### Tool Mounting & Sandboxing
- `ToolMountingService` prepares tool mounts in `/tmp/nexus-tools/<mountKey>/`, validates agent profile access via `canProfileUseTool`, writes SDK allowlist manifest and host mount scope manifest, and auto-cleans on expiry.
- `ToolSandboxService` executes code in containerized sandboxes.
- `SkillMountingService` mirrors tool mounting for skill directories with catalog serialization.
- `ToolContractRepairAdapter` auto-repairs known field aliases and JSON-encoded string fields in runtime payloads with telemetry-gated feedback ingestion when repair rate exceeds 20%.

## Health Findings

- **Test coverage:** 15 spec files in workflow-runtime (~25% of .ts files), 2 in tool-runtime, 1 in tool-registry. Core services (tools, capability executor, orchestration actions, subagents, terminal guard) all have dedicated spec files with mocked dependencies.
- **Notable patterns:** `WorkflowRuntimeToolsService` integrates `ToolContractRepairAdapter` for payload normalization before internal tool execution. Governance evaluation combines `ToolApprovalRuleService`, `ToolPolicyEvaluatorService`, and `PolicyEngineService` for layered deny/approval decisions. Event audit for all lifecycle outcomes via `EventLedgerService.emitBestEffort`.
- **No unresolved TODO/FIXME comments detected** in the core implementation files. The `resolveStandingOrders` stub returns an empty array — may be a deferred feature.

## Open Questions

- **`resolveStandingOrders`** in `WorkflowRuntimeToolsService` currently returns `[]` — confirmed stub. Standing orders resolution against capability-infra is not yet wired.
- **Skill conflict detection** in `CapabilityRegistrarService` is in-memory only; concurrent registration bursts may have transient signature collisions not surfaced unless `strictConflicts` mode is enabled.
- **Tool tier filtering** (`getToolsForTier`) depends on `ToolTierPolicyService` policy implementation which was not read in detail — behavior under `ContainerTier.HEAVY` vs `LIGHT` is unclear from registry code alone.
- **Companion tool auto-injection** in `ToolMountingService.writeSdkToolAllowlist` uses a static `COMPANION_TOOLS` map; any new companion tool pair must be added to `companion-tool.helpers` manually.
