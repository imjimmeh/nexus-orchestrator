---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-dispatch
outcome: success
inferred_status: implemented
confidence_score: 0.95
evidence_refs:
  - apps/kanban/src/dispatch/dispatch.module.ts
  - apps/kanban/src/dispatch/dispatch.controller.ts
  - apps/kanban/src/dispatch/dispatch.service.ts
  - apps/kanban/src/dispatch/dispatch.service.types.ts
  - apps/kanban/src/dispatch/dispatch-internal.types.ts
  - apps/kanban/src/dispatch/dispatch-selected-work-items.ts
  - apps/kanban/src/dispatch/dispatch-work-item-trigger.ts
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.ts
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.types.ts
  - apps/kanban/src/dispatch/project-dispatch-capacity.ts
  - apps/kanban/src/dispatch/project-dispatch-capacity.types.ts
  - apps/kanban/src/dispatch/target-branch-claims.ts
  - apps/kanban/src/dispatch/dispatch.controller.spec.ts
  - apps/kanban/src/dispatch/dispatch.service.spec.ts
  - apps/kanban/src/dispatch/dispatch-selected-work-items.spec.ts
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.spec.ts
  - apps/kanban/src/dispatch/project-dispatch-capacity.spec.ts
  - apps/kanban/src/app.module.ts
  - apps/kanban/src/mcp/kanban-mcp.module.ts
  - apps/kanban/src/mcp/tools/mutation/dispatch-selected-work-items.tool.ts
  - apps/kanban/src/orchestration/orchestration.module.ts
  - apps/kanban/src/orchestration/orchestration-continuation.service.ts
  - apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts
  - apps/kanban/src/orchestration/project-orchestration-wakeup.service.ts
source_paths:
  - apps/kanban/src/dispatch
updated_at: 2026-06-15T17:35:00.000Z
---

# Probe Result: Kanban Dispatch

## Narrative Summary

`apps/kanban/src/dispatch/` is a fully implemented, well-tested, focused module that turns ready (or explicitly selected) Kanban work items into workflow runs on the core platform. The scope was newly carved out of the orchestration module (per `SCOPE_MANIFEST.json` notes) and exposes a NestJS module (`DispatchModule`) with a controller, an injectable service, pure-function helpers, dedicated types, and comprehensive vitest specs.

`DispatchController` exposes two POST endpoints under `projects/:project_id/dispatch`:
- `POST /ready-work-items` — body requires `workflow_id`; supports `limit`, `max_concurrent_per_agent`, `requested_by`, `reconcile_run_status`.
- `POST /selected-context-items` — body requires `context_ids` (non-empty array of non-empty strings); supports `workflow_id` (defaults to `work_item_in_progress_default`), `requested_by`, `max_concurrent_per_agent`. Bad request inputs are rejected with `BadRequestException` via dedicated `requireString`, `requireContextIds`, and `optionalPositiveInteger` validators.

`DispatchService` orchestrates the dispatch lifecycle:
- Loads project work items and their dependencies, optionally reconciles stale terminal runs (FAILED/COMPLETED/CANCELLED), and resets orphaned in-progress items back to `todo`.
- Iterates candidates and applies a layered set of guardrails: idempotency (already-linked items short-circuit to a result entry), status (only `todo` items are dispatchable), dependency readiness (all dependencies must be `done`), per-agent concurrency (when `max_concurrent_per_agent` is set), per-project WIP capacity (from `work_item_dispatch_max_active_per_project` setting), and target-branch ownership dedup (an item with `execution_config.targetBranch` whose branch is already claimed by another lifecycle-active item is skipped with `target_branch_already_dispatched`).
- For accepted runs, it issues `coreClient.requestWorkflowRun(...)` and then writes the work item back with `linked_run_id`, `current_execution_id`, and `status: "in-progress"`, asserting the persisted row matches the accepted run (`"Dispatch mutation was not confirmed"` error otherwise).
- For each dispatched run it attaches `correlation_id`, `causation_id`, `idempotency_key` (`kanban:dispatch:<projectId>:<workItemId>`), and the dynamic Kanban MCP mounts (from `resolveKanbanExternalMcpMounts()`).
- Exposes `reconcileProjectLinkedRuns(projectId)` (terminal + orphan reconciliation), `resolveProjectDispatchCapacity(projectId)` (read-only capacity introspection), and `requestOrchestrationCycle(projectId, { reason, source, dedupeKey })` which emits a `ProjectOrchestrationCycleRequestedEvent` via the core domain-event bus with a deterministic dedupe key (`project-orchestration-cycle:<projectId>:<source>:<reason>[:<windowId>]`).

`dispatchSelectedWorkItems` is a pure-function module that re-implements the same launch/linking path with selection-specific guardrails: it refreshes requested items mid-loop, enforces `slots` upper bound, reconciles terminal linked runs whose agent or target-branch overlaps with the selection, and continues after partial failures (a `dispatch_failed` skip is recorded for the failing item; later items are still attempted). The branch-claim dedup is shared with the ready path via `target-branch-claims.ts` (`ownsTargetBranch`) and `dispatch-work-item-trigger.ts` (`buildDispatchWorkItemTriggerInput` builds the `kanban.work_item.status_changed.v1` event payload).

`orphan-work-item-reconciliation.ts` exports the `isOrphanedInProgressItem` predicate (in-progress with no `linked_run_id` and no `current_execution_id`); the service uses it to recover items that were promoted to `in-progress` by a status mutation that never produced a run.

`project-dispatch-capacity.ts` provides pure helpers (plus a `*ContractItem` variant that operates on the `WorkItemRecord` contract shape from `@nexus/kanban-contracts` — `linkedRunId` / `currentExecutionId` camelCase). It treats `in-progress`, `in-review`, and `ready-to-merge` as "active" statuses, and also counts items that have a `linked_run_id` or `current_execution_id` regardless of status. `resolveProjectDispatchCapacityFromActiveCount` normalizes the cap and computes `availableSlots` / `canLaunchNewWork`.

`target-branch-claims.ts` defines the single boolean `ownsTargetBranch(item)` (linked run or execution, or one of the branch-owning statuses) that both dispatch paths use to build the set of currently-claimed branches.

Wiring:
- `app.module.ts` imports `DispatchModule` at the top level.
- `mcp/kanban-mcp.module.ts` imports `DispatchModule` to feed `DispatchSelectedWorkItemsTool` (mutation tool `kanban.dispatch_selected_work_items`, `tierRestriction: 2`, `transport: runner_local`).
- `orchestration/orchestration.module.ts` imports `DispatchModule` via `forwardRef` and uses it in `OrchestrationContinuationService`, `OrchestrationContinuationReconcilerService`, and `ProjectOrchestrationWakeupService` (which calls `dispatchService.requestOrchestrationCycle` under a single-concurrency cycle lease, with auto-wakeup coalescing and stale-wakeup cooldown).

## Capability Updates

| Capability | Status | Evidence |
|---|---|---|
| NestJS `DispatchModule` registered in app and MCP module | Implemented | `dispatch.module.ts`, `app.module.ts`, `mcp/kanban-mcp.module.ts` |
| `POST projects/:project_id/dispatch/ready-work-items` controller | Implemented | `dispatch.controller.ts` |
| `POST projects/:project_id/dispatch/selected-context-items` controller with default workflow fallback | Implemented | `dispatch.controller.ts` (DEFAULT_SELECTED_CONTEXT_WORKFLOW_ID) |
| Controller input validation (workflow_id, context_ids, max_concurrent_per_agent) | Implemented | `dispatch.controller.spec.ts` (5 cases) + `BadRequestException` paths |
| `DispatchService.dispatchReadyWorkItems` — bulk ready dispatch with reconciliation | Implemented | `dispatch.service.ts` |
| `DispatchService.dispatchSelectedWorkItems` — selection-scoped dispatch | Implemented | `dispatch.service.ts` + `dispatch-selected-work-items.ts` |
| `DispatchService.reconcileProjectLinkedRuns` — terminal + orphan reconciliation | Implemented | `dispatch.service.ts` |
| `DispatchService.resolveProjectDispatchCapacity` — read-only capacity query | Implemented | `dispatch.service.ts` + `project-dispatch-capacity.ts` |
| `DispatchService.requestOrchestrationCycle` — domain event emission with dedupe key | Implemented | `dispatch.service.ts` + `requestOrchestrationCycle` spec |
| Per-agent concurrency enforcement (`max_concurrent_per_agent`) | Implemented | `dispatch.service.ts` (`agentCapacityReached`) |
| Per-project WIP capacity enforcement via `work_item_dispatch_max_active_per_project` setting | Implemented | `dispatch.service.ts` + `project-dispatch-capacity.ts` |
| Target-branch claim deduplication | Implemented | `target-branch-claims.ts`, `dispatch.service.spec.ts`, `dispatch-selected-work-items.spec.ts` |
| Dependency readiness check | Implemented | `dispatch.service.ts` (`dependenciesReady`) |
| Stale terminal run reconciliation with `provision_worktree` special case (reset to `todo`) | Implemented | `dispatch.service.ts` (`reconcileLinkedRuns`) + spec |
| Orphan in-progress item recovery (`isOrphanedInProgressItem` predicate) | Implemented | `orphan-work-item-reconciliation.ts` + spec |
| Idempotency for already-linked items (returns `idempotent: true` result) | Implemented | `dispatch.service.ts` + spec |
| Mutation confirmation (persisted state must match accepted run) | Implemented | `dispatch.service.ts` (`linkAcceptedRun` throws on mismatch) + spec |
| Stable `idempotency_key` per work item (`kanban:dispatch:<projectId>:<workItemId>`) | Implemented | `dispatch.service.ts` + spec |
| Dynamic Kanban MCP mounts attached to dispatched workflow runs | Implemented | `resolveKanbanExternalMcpMounts()` in `dispatch.service.ts` + spec |
| Slot limit (`slots`) and partial-failure handling on selected dispatch | Implemented | `dispatch-selected-work-items.ts` + spec |
| Cross-project and missing-item rejection on selected dispatch | Implemented | `dispatch-selected-work-items.ts` + spec |
| MCP mutation tool `kanban.dispatch_selected_work_items` with tier-2 / runner-local | Implemented | `mcp/tools/mutation/dispatch-selected-work-items.tool.ts` |
| Orchestration cycle wakeup event emission under a cycle lease | Implemented | `orchestration/project-orchestration-wakeup.service.ts` + `DispatchService.requestOrchestrationCycle` |
| Dispatch trigger event payload builder (`kanban.work_item.status_changed.v1`) | Implemented | `dispatch-work-item-trigger.ts` (covered via `dispatch.service.spec.ts` payload assertion) |
| Pure capacity helpers with a `ContractItem` variant for cross-package use | Implemented | `project-dispatch-capacity.ts` + spec |

## Health Findings

- **Test coverage**: 5 dedicated vitest spec files in the dispatch folder (`dispatch.controller.spec.ts`, `dispatch.service.spec.ts`, `dispatch-selected-work-items.spec.ts`, `orphan-work-item-reconciliation.spec.ts`, `project-dispatch-capacity.spec.ts`). Total case count is high (~60+ unit/integration cases) — every public method and every documented skip reason has at least one assertion path.
- **`dispatch.service.spec.ts`** covers: stable dedupe key generation, explicit dedupe key override, orchestration cycle event-emission failure propagation, dependency-ready selection with per-agent capacity, WIP cap enforcement, capacity resolution from settings, dynamic Kanban MCP mounts, idempotent already-linked dispatch (statuses `todo` and `in-progress`), stale terminal run reconciliation, terminal branch-claim non-retention, core status lookup failure reporting, mutation confirmation rejection when persisted state stays in `todo` or relinks to a different run, non-todo candidate skip reporting, no-priority-sort ordering, branch-claim dedup (in-review/done/stale variants), failed-provision reset, orphan recovery for non-provision failed runs, relink-race safety, and the full `dispatchSelectedWorkItems` happy/sad paths (including MCP mounts, missing/cross-project rejection, already-dispatched idempotency, terminal run clear-before-dispatch, per-agent `concurrency_exceeded`, terminal same-agent run clear, `not_dispatchable_status` skip, all-missing reporting, mixed dispatched + skipped, no-priority-sort for selections).
- **`dispatch-selected-work-items.spec.ts`** mirrors the service spec for the pure-function path, including a relink-race scenario that asserts the in-memory linked run is not cleared after a successful relink, slot-limit enforcement, and a "keeps accepted runs claimed when local confirmation fails" scenario that verifies the claimed branch is not released on `dispatch_failed`.
- **`orphan-work-item-reconciliation.spec.ts`** exercises 8 status / run-link / execution-link combinations for `isOrphanedInProgressItem`; coverage is exhaustive for the small truth table.
- **`project-dispatch-capacity.spec.ts`** covers the contract-item variant (the canonical `@nexus/kanban-contracts` shape) including stale-status, terminal-id-only, non-active-status, single-cap, and active-to-active movement cases.
- **`dispatch.controller.spec.ts`** covers the dispatch default workflow, the explicit `workflow_id` override, invalid `context_ids`, empty `context_ids`, and parameterized invalid `max_concurrent_per_agent` values.
- **Code quality**: Every dispatch path that mutates state asserts a post-condition (mutation confirmation in `linkAcceptedRun`, idempotency-key shape, branch-claim release on failure in the selected path). Skipped items are categorized with a closed enum of reason strings (`not_dispatchable_status`, `dependencies_not_ready`, `agent_capacity_reached` / `concurrency_exceeded`, `target_branch_already_dispatched`, `core_status_unavailable`, `work_item_not_found`, `work_item_cross_project`, `dispatch_slot_limit_reached`, `project_wip_limit_reached`, `dispatch_failed`). Errors surface to callers as concrete `Error("Dispatch mutation was not confirmed for work item ...")` exceptions and as logger warnings on orphan-reset failure.
- **Module structure**: The selected-dispatch path is implemented as a pure function module (`dispatch-selected-work-items.ts`) with a `DispatchServiceDeps` interface, which makes it independently testable and aligns with the comment in `dispatchCandidate`: "Keep selected dispatch launch/linking aligned with DispatchService while this batch path enforces selection-specific guardrails and partial failure results."
- **Indirect test coverage**: `target-branch-claims.ts` and `dispatch-work-item-trigger.ts` have no dedicated spec files, but both are exercised by the service and selected-work-items specs (the latter is verified by the full `request.input` shape assertion in `dispatch.service.spec.ts` — e.g., `event: "kanban.work_item.status_changed.v1"`, `dependsOn`, `blockedBy`, and the `resource` projection).
- **Churn / integration footprint**: Dispatch is consumed by the orchestration module (3 services: `OrchestrationContinuationService`, `OrchestrationContinuationReconcilerService`, `ProjectOrchestrationWakeupService`), the MCP module (`DispatchSelectedWorkItemsTool`), and the root app module. No duplication of dispatch logic was observed in those consumers — they delegate to `DispatchService`.

## Open Questions

- The 2026-06-15 `OPEN_QUESTIONS.md` entry **R10** ("`apps/kanban/src/dispatch/` and `apps/kanban/src/orchestration/dispatch*` services are partially overlapping in naming; the boundary between `dispatch` module and the `reconciled-work-item-publisher` inside orchestration is not yet mapped") is now answerable: the boundaries are clean. `apps/kanban/src/dispatch/` owns the launch-side (turning a ready/selected Kanban work item into a `core` workflow run, plus per-project WIP, per-agent concurrency, branch-claim dedup, and terminal/orphan reconciliation). `apps/kanban/src/orchestration/reconciled-work-item-publisher.ts` (`ReconciledWorkItemPublisher.publish`) is the import-side — it turns an `ImportedRepositoryBacklogReconciliationPlan` (a list of `RepositoryWorkItemSpec`) into created/updated/unchanged work items in the project backlog. The naming overlap is a coincidence (`dispatch` = "dispatch to a workflow run" vs. `reconciled-work-item-publisher` = "publish reconciled backlog items into the database"); the responsibilities do not overlap. This entry can be closed in a future refresh.
- `dispatch-work-item-trigger.ts` and `target-branch-claims.ts` are exercised only transitively. Adding narrow direct specs would improve diff readability for future branch-claim and trigger-payload changes, but the existing coverage is functionally complete.
- `kanban.project_state` and `kanban.orchestration_timeline` runtime tools were not available to this subagent, so the playbook's step 1 could not be executed directly. The probe proceeded with file-based discovery and consumer-trace (`grep` of `DispatchService` / `DispatchModule` / `DispatchController` references across the kanban tree) which is sufficient for the static read of this scope. Downstream consumers that depend on live kanban state should be cross-validated by the orchestrator.
- The `dispatchReadyWorkItems` path iterates project items in source order (no priority sort, asserted by the "no longer sorts dispatch candidates by priority order" spec) — this is intentional, but operators who relied on the prior p0-first ordering should review the migration notes. This is a behavioural question, not an implementation gap.
- The `idempotency_key` for the selected-dispatch path is identical to the ready-dispatch path (`kanban:dispatch:<projectId>:<workItemId>`); the distinct launch source and metadata (`requested_by`, optional `slots`) are the only differentiators. The core workflow-run request must therefore dedupe on `(idempotency_key, projectId)` as designed.
