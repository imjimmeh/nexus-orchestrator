# Orchestration and Kanban Process Review

_Source reviewed: branch `main`, commit `0ffc6d89`, current as of 2026-05-18._

This directory documents how Nexus Orchestrator connects workflows, Kanban lifecycle events, agents, tools, prompts, and skills.

- [`workflow-catalog.md`](./workflow-catalog.md) — complete seeded workflow list and status/event automation matrix.
- [`agent-tool-skill-catalog.md`](./agent-tool-skill-catalog.md) — seeded agents, prompts, skills, Kanban MCP tools, and runtime/internal tool surfaces.

## Ownership Boundary

- API/core owns generic workflow parsing, event trigger registration, run execution, DAG/job execution, special step handlers, and generic domain-event ingestion.
- Kanban owns work item state, status names, dispatch decisions, lifecycle event payload shape, Kanban MCP tools, project orchestration state, and run-link cleanup.
- API/core must stay Kanban-neutral; Kanban-specific behavior is expressed by Kanban-owned events/tools and seeded workflows.

## High-level Flow

```text
Human/UI/API/Agent
  ├─ manual workflow launch -> API WorkflowLaunchController -> WorkflowEngine.startWorkflow
  ├─ Kanban status change -> WorkItemService.updateStatus
  │    -> KanbanLifecycleEventPublisher
  │    -> Core generic domain-event ingest
  │    -> EventEmitter2 emits kanban.work_item.status_changed.v1
  │    -> WorkflowEventTriggerService starts matching workflow
  ├─ Kanban dispatch/wakeup/tool
  │    -> DispatchService / ProjectOrchestrationWakeupService
  │    -> Core workflow-run request or Core domain event
  │    -> event-triggered CEO/dispatch workflow
  └─ workflow special jobs/tools
       ├─ invoke_workflow -> child workflow run
       ├─ mcp_tool_call -> Kanban MCP or other external mount
       ├─ git_operation -> worktree/merge/branch/cleanup
       ├─ emit_event -> EventEmitter2 domain event
       └─ run_command/web_automation/register_tool/manage_tool_candidate/etc.
```

## API/Core Runtime Pieces

| Component                   | Path                                                                                            | Responsibility                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow trigger registry   | `apps/api/src/workflow/workflow-trigger-registry.service.ts`                                    | Parses active workflows and resolves unique event/webhook bindings. Latest workflow rows win by recency; duplicate logical bindings are skipped.                 |
| Trigger condition evaluator | `apps/api/src/workflow/workflow-trigger-condition.helpers.ts`                                   | Evaluates Handlebars `trigger.condition`; only rendered `true` launches.                                                                                         |
| Event trigger service       | `apps/api/src/workflow/workflow-event-trigger.service.ts`                                       | Registers EventEmitter listeners at startup and starts matching workflow runs. Uses process-local dedupe keyed by eventId/scope/context/workflow.                |
| Domain event ingestion      | `apps/api/src/workflow/workflow-internal-domain-events.*`                                       | Accepts internal generic domain/chat events, writes event ledger, publishes to domain-event bus/plugin publisher, and emits local EventEmitter lifecycle events. |
| Workflow engine             | `apps/api/src/workflow/workflow-engine.service.ts`                                              | Loads workflow definition, applies launch dedupe/concurrency, creates workflow run, emits run lifecycle events, and enqueues first DAG jobs.                     |
| Concurrency policy          | `apps/api/src/workflow/concurrency-policy.service.ts`                                           | Resolves scope and applies `max_runs` + `on_conflict`: `skip`, `queue`, or `cancel_running`.                                                                     |
| Launch controller/service   | `apps/api/src/workflow/workflow-launch/**`                                                      | Manual launch API and launch contract/preset validation.                                                                                                         |
| Special step handlers       | `apps/api/src/workflow/workflow-special-steps/*.handler.ts`                                     | Execute non-agent jobs such as `invoke_workflow`, `mcp_tool_call`, `git_operation`, `emit_event`, `run_command`, `web_automation`, etc.                          |
| Runtime/internal tools      | `apps/api/src/workflow/workflow-runtime/**`, `apps/api/src/workflow/workflow-internal-tools/**` | Agent-facing runtime callbacks and internal tools (`set_job_output`, workflow search/read, skill/playbook discovery, todo, schedules, memory).                   |

## Kanban Runtime Pieces

| Component                      | Path                                                                    | Responsibility                                                                                                                 |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Work item service              | `apps/kanban/src/work-item/work-item.service.ts`                        | Creates/updates work items, validates status changes, stores execution config/QA feedback, and calls lifecycle publisher.      |
| Lifecycle publisher            | `apps/kanban/src/work-item/kanban-lifecycle-event-publisher.ts`         | Emits canonical `kanban.work_item.status_changed.v1` only after an actual persisted status change.                             |
| Dispatch service               | `apps/kanban/src/dispatch/dispatch.service.ts`                          | Selects `todo` work items, checks dependencies/capacity/branch claims, starts implementation runs, and reconciles linked runs. |
| Selected dispatch helper       | `apps/kanban/src/dispatch/dispatch-selected-work-items.ts`              | Dispatches explicitly selected work item IDs with the same linked-run/capacity/branch safeguards.                              |
| Project orchestration service  | `apps/kanban/src/orchestration/orchestration.service.ts`                | Tracks project orchestration status, linked CEO runs, decisions, wakeup metadata, and direct start.                            |
| Wakeup service                 | `apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts` | Emits cycle-request wakeups only when active-cycle, stop-decision, coalescing, and cooldown gates pass.                        |
| Continuation/reconciler        | `apps/kanban/src/orchestration/orchestration-continuation*.ts`          | Re-evaluates whether a project should continue/repeat/stop and requests wakeups for stale/terminal lifecycle conditions.       |
| Core lifecycle stream consumer | `apps/kanban/src/core/core-lifecycle-stream.consumer.ts`                | Consumes Core run lifecycle events, reconciles terminal runs, clears links, and may request wakeups.                           |
| Kanban MCP server              | `apps/kanban/src/mcp/**`                                                | Exposes Kanban-owned read/mutation tools used by workflows through `mcp_tool_call`.                                            |

## Workflow Launch Paths

### 1. Manual launch

Manual workflows are launched from UI/API/presets through `WorkflowLaunchController` and `WorkflowLaunchOrchestrationService`. They validate launch context/input contracts and call `WorkflowEngine.startWorkflow`.

Use manual launch for:

- `standard_feature_flow`, `hotfix_flow`, `documentation_audit`, `project_orchestration_advisor`.
- Repair/diagnostic flows like `workflow_failure_doctor`.
- Investigation/generation flows like `project_codebase_deep_investigation` and `project_generate_agents_md`.

Do not expect manual-only workflows to react to events unless another workflow invokes them.

### 2. Event-triggered launch

Event workflows are registered at API startup. When EventEmitter2 emits a matching event, `WorkflowEventTriggerService`:

1. Copies event payload into trigger data.
2. Copies non-enumerable `eventId` and `dedupeKey` when present.
3. Evaluates `trigger.condition`.
4. Skips duplicate event IDs seen in the local dedupe window.
5. Calls `WorkflowEngine.startWorkflow(binding.workflowId, triggerData)`.
6. Lets workflow concurrency decide proceed/skip/queue/cancel.

Expected event-triggered workflows are listed in [`workflow-catalog.md`](./workflow-catalog.md).

### 3. Kanban direct Core workflow-run request

Some Kanban services call Core `/internal/core/workflow-runs` directly through `CoreWorkflowClientService.requestWorkflowRun()` instead of emitting a trigger event. These requests include `launch_source`, context metadata, idempotency keys, and optional Kanban MCP mounts.

Primary direct path:

- Dispatch selected/ready items launches `work_item_in_progress_default` using a synthetic trigger payload shaped like `kanban.work_item.status_changed.v1` with status `in-progress`.

### 4. Child workflow invocation

Workflow jobs of type `invoke_workflow` or runtime tool `invoke_agent_workflow` start child workflows. Typical uses:

- CEO workflows invoking `orchestration_invoke_agent_default` for delegated PM/architect/dev work.
- `standard_feature_flow` invoking discovery/spec/implementation/QA/review stages.
- `hotfix_flow` invoking implementation and quality gates.

Child invocation is governed by the caller's allowed tools and any profile-level `tool_policy`.

## Kanban Status Lifecycle

Known statuses:

```text
backlog -> todo -> refinement -> in-progress -> in-review -> ready-to-merge -> done
          blocked can be used as a stop/wait state
```

The implementation currently permits any known status to transition to any other known status. Unknown targets are rejected. Same-status updates no-op and do not emit lifecycle automation.

Status automation only fires after `WorkItemService.updateStatus()` persists a real status change and `KanbanLifecycleEventPublisher` emits `kanban.work_item.status_changed.v1`.

## Expected Launch / No-launch Conditions

### Work item workflows should launch when

- `work_item_split_default`: item enters `refinement`, resource exists, scope is `large`, and it is a root item without `metadata.split.parentId`.
- `work_item_refinement_default`: item enters `refinement`, resource exists, it is not the large-root split case, and refinement metadata gates allow another pass.
- `work_item_in_progress_default`: item enters/is dispatched as `in-progress`.
- `work_item_in_review_default`: item enters `in-review`.
- `work_item_ready_to_merge_default`: item enters `ready-to-merge`.
- `work_item_post_merge_spec_hydration`: merge workflow emits `WorkItemMergeCompletedEvent`.

### Work item workflows should not launch when

- Status was written directly in DB rather than through `WorkItemService.updateStatus()`.
- Same-status update occurs.
- Event trigger condition renders anything except `true`.
- Event dedupe suppresses a repeated `eventId` for the same workflow/scope/context.
- Workflow concurrency scope already has an active run and policy is `skip`.
- Dispatch finds item not `todo`, already linked to a run, dependencies not `done`, agent capacity full, target branch claimed, or dispatch limit reached.

### Project orchestration cycles should launch when

- Project orchestration starts and emits `ProjectOrchestrationStartedEvent`; this triggers discovery unless the project was already orchestrating.
- A service/tool emits `ProjectOrchestrationCycleRequestedEvent`; this triggers `project_orchestration_cycle_ceo` if concurrency allows.
- Wakeup service gates pass: no active/pending cycle, no active auto-wake-suppressing stop decision, outside coalescing/cooldown windows.
- Work item merge/spec revision/bootstrap flows emit follow-on cycle request events.

### Project orchestration cycles should not launch when

- `ProjectOrchestrationWakeupService` sees active or pending cycle.
- Current decision suppresses automatic wakeups (`pause`, `complete`, or `blocked`).
- Automatic wakeup is inside 60-second coalesce window.
- Stale reconciler wakeup is inside 5-minute cooldown.
- `project_orchestration_cycle_ceo` already has active run in same `trigger.scopeId`; concurrency policy is `skip`.
- `project_discovery_ceo` receives `previousOrchestrationStatus == orchestrating`.

## Run-link and Cleanup Expectations

Kanban stores Core workflow run IDs on project/work-item projections:

- Work item: `linked_run_id`, `current_execution_id`.
- Project orchestration: `linked_run_id` and metadata/decision logs.

Cleanup happens when Core lifecycle status is terminal (`COMPLETED`, `FAILED`, `CANCELLED`) and the linked run ID still matches. Provision-worktree failures are special-cased: an `in-progress` item can be reset to `todo` after link cleanup if the failed run was at `current_step_id == provision_worktree`.

## Boundary Rules for Future Changes

- Add Kanban behavior in Kanban services/tools/workflows, not API/core generic runtime.
- Add workflow triggers in YAML when possible; `WorkflowTriggerRegistryService` picks them up on startup after seeding.
- Use explicit Kanban tool names (`kanban.project_state`, `kanban.work_item_transition_status`, etc.). Do not reintroduce API-owned aliases for Kanban state.
- Prefer cycle-request events/wakeup service over directly launching duplicate CEO cycles.
- Add concurrency scopes to any workflow that can be emitted repeatedly from lifecycle events.
