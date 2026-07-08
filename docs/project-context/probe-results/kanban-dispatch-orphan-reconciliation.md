---
project_scope_id: 458935f0-213e-4bbe-89d1-8883e0efa9ad
probe_scope_id: kanban-dispatch-orphan-reconciliation
outcome: success
inferred_status: implemented
confidence_score: 0.92
evidence_refs:
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.ts
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.types.ts
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.spec.ts
  - apps/kanban/src/dispatch/dispatch-work-items-reconciliation.ts
  - apps/kanban/src/dispatch/dispatch-work-items.core.ts
  - apps/kanban/src/dispatch/project-dispatch-capacity.ts
  - apps/kanban/src/dispatch/project-dispatch-capacity.types.ts
  - apps/kanban/src/dispatch/target-branch-claims.ts
  - apps/kanban/src/dispatch/dispatch.service.ts
  - apps/kanban/src/dispatch/dispatch.service.types.ts
  - apps/kanban/src/dispatch/dispatch-core.types.ts
  - apps/kanban/src/dispatch/dispatch-internal.types.ts
  - apps/kanban/src/dispatch/dispatch-candidate.helpers.ts
  - apps/kanban/src/dispatch/dispatch-target-branch.helper.ts
  - apps/kanban/src/dispatch/dispatch-selected-work-items.ts
  - apps/kanban/src/dispatch/dispatch.service.spec.ts
  - apps/kanban/src/dispatch/dispatch-work-items.core.spec.ts
  - apps/kanban/src/dispatch/project-dispatch-capacity.spec.ts
  - apps/kanban/src/dispatch/target-branch-claims.spec.ts
  - apps/kanban/src/orchestration/orchestration-continuation-reconciler.service.ts
source_paths:
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.ts
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.types.ts
  - apps/kanban/src/dispatch/orphan-work-item-reconciliation.spec.ts
  - apps/kanban/src/dispatch/dispatch-work-items-reconciliation.ts
  - apps/kanban/src/dispatch/dispatch-work-items.core.ts
  - apps/kanban/src/dispatch/project-dispatch-capacity.ts
  - apps/kanban/src/dispatch/target-branch-claims.ts
updated_at: 2026-07-02T00:00:00.000Z
---

# Probe Result: Kanban Dispatch Orphan-Work-Item Reconciliation

## Narrative Summary

The Kanban dispatch module has a complete, narrow, well-typed **orphan-work-item reconciliation** feature that detects work items left stranded in `in-progress` status with no linked workflow run (no `linked_run_id`, no `current_execution_id`) and resets them to `todo` so the next dispatch cycle can pick them up. The probe scope's seven files form a coherent sub-feature inside `apps/kanban/src/dispatch/`:

- **`orphan-work-item-reconciliation.ts`** (35 LOC) exports the pure predicate `isOrphanedInProgressItem(item)` that returns `true` only when `status === "in-progress" && !linked_run_id && !current_execution_id`. The file's leading comment documents the motivating bug: such items are invisible to `dispatchCandidate()` (only dispatches `"todo"`), `reconcileLinkedRuns()` (only processes items with `linked_run_id`), and `isDispatchableWorkItem()` (`DISPATCHABLE_STATUSES = {"todo"}`), so without explicit recovery they stay stuck forever. The file re-exports the types from `.types.ts`.
- **`orphan-work-item-reconciliation.types.ts`** (8 LOC) defines the two result-shape interfaces: `OrphanReconciliationEntry` (`{ workItemId, previousStatus }`) and `OrphanReconciliationSummary` (`{ orphanReconciled: OrphanReconciliationEntry[] }`).
- **`orphan-work-item-reconciliation.spec.ts`** (84 LOC) exhaustively exercises `isOrphanedInProgressItem` across 8 cases — the only-true case (`in-progress` + both nulls), and 7 false cases (every other status, every combination of one or both link IDs being non-null). The truth table is fully covered.
- **`dispatch-work-items-reconciliation.ts`** (234 LOC) contains the reconciler triad: `reconcileAllLinkedRuns`, `reconcileSelectedScope`, `reconcileOrphans`, `clearTerminalLinkedRun`, `refreshRequestedItems`, `buildReconcileScope`. `reconcileOrphans(deps, items, result)` is the orphan-recovery entry point — it iterates `items`, uses `isOrphanedInProgressItem` to detect orphans, calls `deps.workItemService.updateStatus(projectId, itemId, "todo")`, swallows per-item errors into a `logger.warn(...)` line (so a single failed reset does not abort the cycle), mutates the in-memory `item.status = "todo"`, and pushes an `OrphanReconciliationEntry` onto `result.orphanReconciled`. The function no-ops when `deps.workItemService` is absent (so test doubles without the service stay pure).
- **`dispatch-work-items.core.ts`** (519 LOC) is the unified dispatch core that drives both `dispatchReadyWorkItems` and `dispatchSelectedWorkItems` from a single `dispatchWorkItems(deps, options)` function. Its `prepareDispatchContext` runs reconciliation before dispatching: `reconcileStaleRuns(...)` first (gated by `options.reconcileRunStatus ?? selectedMode`), then `reconcileOrphans(...)` (gated by `options.reconcileOrphans ?? !selectedMode`). The `DispatchResult` it returns is initialized with `orphanReconciled: []`, and the type union of tracked fields includes `"reconciled" | "skipped" | "orphanReconciled"`.
- **`project-dispatch-capacity.ts`** (99 LOC) provides the per-project WIP-cap helpers used by the same core. It defines `PROJECT_DISPATCH_ACTIVE_STATUSES = {"in-progress", "in-review", "ready-to-merge"}`, `PROJECT_DISPATCH_TERMINAL_STATUSES = {"done"}`, and `isProjectDispatchActive(item)` which counts an item as active iff it has a link/execution OR an active status (and explicitly excludes terminal `done` items even if they carry stale link projections). `resolveProjectDispatchCapacityFromActiveCount` is the pure function the core calls to compute `canLaunchNewWork` for the pre-flight gate; `resolveProjectDispatchCapacity` is the convenience wrapper that counts then resolves. A separate `*ContractItem` variant exposes the same logic to cross-package callers using `@nexus/kanban-contracts`' camelCase `linkedRunId`/`currentExecutionId` shape.
- **`target-branch-claims.ts`** (16 LOC) exports the single boolean predicate `ownsTargetBranch(item)` (true iff the item has a linked run/execution OR a branch-owning status: `in-progress`, `in-review`, `ready-to-merge`, `awaiting-pr-merge`). It is consumed by `dispatch-target-branch.helper.ts` (`claimDispatchSlot`, `collectActiveTargetBranches`) so both the ready-mode and selected-mode dispatch loops can dedupe by target branch without re-implementing the predicate.

The orphan-recovery contract is fully wired into the live system:

- `DispatchService.dispatchReadyWorkItems` (`dispatch.service.ts:55-81`) calls the core with `reconcileOrphans: true` (default for ready-mode).
- `DispatchService.dispatchSelectedWorkItems` (`dispatch.service.ts:135-161`) calls the core with `reconcileOrphans: false` (selected batches never sweep the whole project).
- `DispatchService.reconcileProjectLinkedRuns(projectId)` (`dispatch.service.ts:104-122`) is the public façade that runs both terminal-run clearing and orphan recovery against a project's items, and is consumed by `OrchestrationContinuationReconcilerService.reconcileStaleContinuations` (`orchestration-continuation-reconciler.service.ts:60-100`), which on detection of any `orphanReconciled` entries calls `clearCycleDecision(projectId, { reason: "Automatic clear: <count> orphaned in-progress work item(s)..." })` so the next CEO cycle can resume dispatch.
- The dispatch trigger (`dispatch-work-item-trigger.ts`) emits `kanban.work_item.status_changed.v1` when an orphan is reset to `todo`, so downstream consumers (orchestration wakeup, MCP) see the recovery as a normal status transition.

The result type `DispatchResult.orphanReconciled: OrphanReconciliationEntry[]` (and its narrow cousin `DispatchRunReconciliationSummary` which `Pick`s `"reconciled" | "skipped" | "orphanReconciled"`) is threaded through `dispatch.service.types.ts:50-57` and is asserted in unit tests (e.g. `dispatch.service.spec.ts:1004-1011` "resets to todo when non-provision failed run links are cleared (orphan recovery)" verifies the array shape).

## Capability Updates

| Capability                                                                                                                                 | Status      | Evidence                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | --------------------------------------------------------------------- |
| Pure predicate `isOrphanedInProgressItem` (truth-table complete)                                                                           | Implemented | `orphan-work-item-reconciliation.ts`                                  |
| `OrphanReconciliationEntry` / `OrphanReconciliationSummary` types                                                                          | Implemented | `orphan-work-item-reconciliation.types.ts`                            |
| `reconcileOrphans(deps, items, result)` walking project items and resetting orphans to `todo`                                              | Implemented | `dispatch-work-items-reconciliation.ts:146-177`                       |
| Per-item error isolation in `reconcileOrphans` (failed `updateStatus` logs warn, does not abort cycle)                                     | Implemented | `dispatch-work-items-reconciliation.ts:163-170`                       |
| In-memory `item.status` mutation after DB reset (so downstream dispatch loops see the corrected status)                                    | Implemented | `dispatch-work-items-reconciliation.ts:171-175`                       |
| Dispatch core `DispatchResult.orphanReconciled: OrphanReconciliationEntry[]`                                                               | Implemented | `dispatch-work-items.core.ts:94`, `dispatch.service.types.ts:50-55`   |
| `DispatchCoreOptions.reconcileOrphans` flag (default `true` for ready-mode, `false` for selected-mode)                                     | Implemented | `dispatch-core.types.ts:68-71`, `dispatch-work-items.core.ts:122-124` |
| Ready-mode `dispatchReadyWorkItems` runs orphan recovery                                                                                   | Implemented | `dispatch.service.ts:80` (`reconcileOrphans: true`)                   |
| Selected-mode `dispatchSelectedWorkItems` opts out of orphan recovery                                                                      | Implemented | `dispatch.service.ts:151`, `dispatch-selected-work-items.ts:26`       |
| Public façade `DispatchService.reconcileProjectLinkedRuns(projectId)` running both terminal + orphan reconciliation                        | Implemented | `dispatch.service.ts:104-122`                                         |
| Orchestration continuation reconciler consumes `orphanReconciled` to auto-clear stop decisions                                             | Implemented | `orchestration-continuation-reconciler.service.ts:71-86`              |
| Per-project WIP capacity helpers (`isProjectDispatchActive`, `countActiveProjectDispatches`, `resolveProjectDispatchCapacity*`)            | Implemented | `project-dispatch-capacity.ts` + `.spec.ts`                           |
| Terminal-status exemption (`done` items never consume a slot even with stale link IDs)                                                     | Implemented | `project-dispatch-capacity.ts:18-32, 56-59`                           |
| Cross-package contract-item variant of capacity helpers (camelCase IDs)                                                                    | Implemented | `project-dispatch-capacity.ts:42-65`                                  |
| `ownsTargetBranch(item)` predicate covering `awaiting-pr-merge` + 3 existing statuses + link/execution presence                            | Implemented | `target-branch-claims.ts` + `.spec.ts`                                |
| Dispatch target-branch helper reuses `ownsTargetBranch` for slot collection + claim                                                        | Implemented | `dispatch-target-branch.helper.ts:10-19, 50-66`                       |
| Spec coverage for `isOrphanedInProgressItem` (8 cases — full truth table)                                                                  | Implemented | `orphan-work-item-reconciliation.spec.ts`                             |
| Spec coverage for project capacity helpers (7 cases, contract + snake-case variants)                                                       | Implemented | `project-dispatch-capacity.spec.ts`                                   |
| Spec coverage for `ownsTargetBranch` (4 cases — new + existing statuses)                                                                   | Implemented | `target-branch-claims.spec.ts`                                        |
| Spec coverage for orphan recovery in dispatch service ("resets to todo when non-provision failed run links are cleared (orphan recovery)") | Implemented | `dispatch.service.spec.ts:978-1011`                                   |

## Health Findings

- **Test coverage**: The narrow `isOrphanedInProgressItem` predicate has 8 dedicated unit tests covering every (status × linked_run_id × current_execution_id) combination that can matter — the only-true case (in-progress + both nulls) and 7 false cases (other statuses, items with at least one link). `project-dispatch-capacity.spec.ts` covers 7 cases including the contract-item variant, stale-status projection, terminal-id-only items, and the snake_case variant for in-process `WorkItemRecord`s. `target-branch-claims.spec.ts` covers 4 cases (`awaiting-pr-merge`, `in-progress`, `in-review`, `ready-to-merge`, `backlog`). `dispatch.service.spec.ts:978-1011` covers the end-to-end orphan recovery via `reconcileProjectLinkedRuns` (FAILED non-provision run → orphan reset). `dispatch-work-items.core.spec.ts` exercises the unified core with `reconcileOrphans: false` (proving the flag actually toggles the call). No dedicated spec exists for `dispatch-work-items-reconciliation.ts` itself — the reconciler triad (`reconcileAllLinkedRuns`, `reconcileSelectedScope`, `reconcileOrphans`, `clearTerminalLinkedRun`) is exercised transitively via `dispatch.service.spec.ts` (terminal-run clearing, race-with-relink, terminal-status arg passing, orphan recovery) and the integration suite at `apps/kanban/test/work-item-run-link-race.integration-spec.ts:727,747` (which asserts `orphanReconciled` is `[]` when no orphans are present). Adding a narrow direct spec for `reconcileOrphans` (success path, error-swallow path, no-service-noop path) would improve diff readability.
- **Code quality**: The orphan-recovery code is small, single-purpose, and well-typed. The predicate takes a structural type `{ status: string; linked_run_id: string | null; current_execution_id: string | null }` so it does not bind to the concrete `WorkItemRecord` and is trivially testable. The reconciler uses `?? null` coercions so the structural predicate works whether or not the caller has hydrated the link fields. Errors are caught narrowly (one `try` wraps the single `updateStatus` call) and converted to `logger.warn(...)` with the work item id and the thrown message — failures are observable but non-fatal to the cycle. The orchestrator consumer (`OrchestrationContinuationReconcilerService`) reads `orphanReconciled.length > 0` to gate the cycle-decision clear, so a missing field would be detected immediately at runtime. No `eslint-disable` / `@ts-ignore` / quarantine symbols are present anywhere in the probe scope (consistent with the project's strict-lint policy).
- **Module structure**: The reconciliation triplet (`reconcileAllLinkedRuns`, `reconcileSelectedScope`, `reconcileOrphans`) lives in one cohesive file `dispatch-work-items-reconciliation.ts`, separated from the dispatch loop in `dispatch-work-items.core.ts`. The pure predicates (`isOrphanedInProgressItem`, `ownsTargetBranch`, the project-dispatch-capacity helpers) live in their own single-purpose files. The dispatch target-branch helper is the only consumer of `target-branch-claims.ts`. `orphan-work-item-reconciliation.ts` is the only consumer of `orphan-work-item-reconciliation.types.ts`. No circular imports.
- **Cross-module wiring**: `DispatchService.reconcileProjectLinkedRuns` is consumed by both the dispatch-ready path (via `dispatchWorkItems`) and the orchestration continuation reconciler (via `reconcileStaleContinuations`). The orchestration consumer's behavior on orphan detection is precisely scoped: log a single line with the count, then call `clearCycleDecision(projectId, { reason: ... })`, then fall through to the normal wakeup gate. The cycle decision clear is itself wrapped in its own `try/catch` so a clear failure does not block the wakeup request. This is the recommended pattern for the kind of "side-effect of a side-effect" recovery action.
- **Churn / coupling footprint**: 7 in-scope files, all co-located in `apps/kanban/src/dispatch/`. No new consumers outside the kanban module — the API/core boundary is preserved (the kanban dispatch publishes `kanban.work_item.status_changed.v1` events for the reset; the core subscribes through its domain-event bus). This is consistent with the project's `core-kanban-boundaries` rule (API/core never reads kanban tables; Kanban owns its lifecycle).

## Open Questions

- The 2026-06-15 prior probe (`docs/project-context/probe-results/kanban-dispatch.md`) characterized this same feature at a higher level; this narrower probe validates the **individual file-level contracts** (predicate truth table, reconciler error isolation, dispatch-core flag defaulting, project-capacity invariant under stale-link projections, target-branch predicate coverage). No contradictions were found between the two probes; the newer probe just confirms the implementation is consistent with what the older one summarized.
- There is no dedicated unit spec for `reconcileOrphans` itself. The end-to-end behavior is asserted via `dispatch.service.spec.ts:978-1011`, and the no-op case is asserted via `dispatch-work-items.core.spec.ts:88` (`reconcileOrphans: false`). A direct spec for `reconcileOrphans` covering (a) successful reset + entry appended + in-memory status mutated, (b) `workItemService` undefined → no-op, (c) `updateStatus` throws → warn + continue + no entry appended, would tighten coverage. This is a coverage gap, not an implementation gap.
- The `reconcileOrphans` function mutates `item.status = "todo"` in-memory after the DB reset. If a future caller forgets to pass the same item array into the dispatch loop (i.e. re-reads from the DB after reconciliation), the in-memory mutation is wasted but harmless. If a caller passes a _different_ array, the in-memory mutation will not affect the dispatch loop's view. The current code in `dispatch-work-items.core.ts` does pass `projectItems` (the array the reconciler mutated) to `buildCandidateList`, so the mutation is observed correctly today. This invariant is implicit and could be made explicit with a comment on `reconcileOrphans`'s docstring (or a return-by-ref signature annotation).
- The orphan-recovery path resets to `"todo"` regardless of the original `in-progress` reason. If a future feature allows non-default `in-progress` reasons (e.g. `in-progress:awaiting-approval`), the predicate and reset logic would need to grow a reason-aware branch. Today there is exactly one `in-progress` literal in the type system.
- `kanban.project_state` and `kanban.orchestration_timeline` runtime tools were not exercised in this probe (consistent with the playbook note about the static-read fallback). The probe is grounded entirely in file reads + grep + structural inspection, which is sufficient to characterize the implementation but cannot validate runtime behavior in a live deployment. The dispatch.controller spec and the integration suite at `apps/kanban/test/work-item-run-link-race.integration-spec.ts` and `apps/kanban/test/split-service/wip-cap-reconciler.integration-spec.ts` provide the live-stack coverage for this feature.
