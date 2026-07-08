# `apps/kanban/src/work-item` — Failure-Mode Inventory

This README tracks the race-safety failure modes that the current
`WorkItemService.requestWorkItemRun` cannot defend against. Each scenario
is mapped to a target test case that will be authored in the Milestone 6
test plan, and to the race-safety strategy adopted in
[`ADR-20260623-work-item-run-link-lease.md`](../../../../../docs/architecture/ADR-20260623-work-item-run-link-lease.md).

The scenarios below are interleavings of the six mutators of the
work-item link columns (`linked_run_id`, `current_execution_id`):

| # | Mutator | File |
| --- | --- | --- |
| M1 | `WorkItemService.requestWorkItemRun` (dispatch / review / merge) | `work-item.service.ts` |
| M2 | `WorkItemService.requestWorkItemRun` (different action, same work item) | `work-item.service.ts` |
| M3 | `CoreLifecycleStreamConsumer.linkWorkItemRunFromLifecycleEvent` | `core/core-lifecycle-stream.consumer.ts` |
| M4 | `DispatchService.linkAcceptedRun` | `dispatch/dispatch.service.ts` |
| M5 | `dispatchSelectedWorkItems.linkAcceptedRun` | `dispatch/dispatch-selected-work-items.ts` |
| M6 | Partial-write window inside `requestWorkItemRun` after `requestWorkflowRun` | `work-item.service.ts` |

The conditional `linkRunIfUnlinked` UPDATE
(`WHERE linked_run_id IS NULL AND current_execution_id IS NULL`) is the
only race-safety barrier on the hot path today. It defends against
**F1** (two concurrent `linkRunIfUnlinked` calls observing the same null
state) but does not defend against **F2–F6** below.

## Scenarios

### F1 — Concurrent `dispatchWorkItem` calls on the same work item

- **Mutators interleaved:** M1 + M1 (two `dispatchWorkItem` callers).
- **Current behaviour:** the conditional `linkRunIfUnlinked` UPDATE
  resolves the race: the first call commits both link columns, the second
  call's UPDATE matches zero rows and throws
  `ConflictException("Work item ... is already linked to a workflow run")`.
  The second caller's Core run is accepted, then immediately orphaned on
  the kanban side — no kanban reconciliation can re-link it because the
  idempotency key is per-work-item and the work item already has a
  `linked_run_id`.
- **Expected behaviour:** the second caller must fail *before* invoking
  Core, so the orphaned run never exists. With
  `ADR-20260623-work-item-run-link-lease` (option **b**), the second
  caller fails the per-work-item lease acquisition and surfaces a
  `ConflictException` without calling `requestWorkflowRun`.
- **Target test case (Milestone 6):** `requestWorkItemRun › rejects
  second dispatchWorkItem call when per-work-item lease is held`.

### F2 — Concurrent `dispatchWorkItem` + `submitReviewDecision`

- **Mutators interleaved:** M1 (dispatch) + M2 (review).
- **Current behaviour:** the review action mutates
  `status → ready-to-merge` (approve) or `status → in-progress` (reject)
  *and* triggers a workflow launch. The two callers race on the same
  work item: whichever commits its status mutation second can clobber
  the first caller's `linked_run_id` if the in-memory `item` snapshot
  taken at the top of `requestWorkItemRun` no longer reflects the
  persisted link. The work item ends up with a `linked_run_id` that no
  longer matches its current status, or a status that disagrees with the
  linked run.
- **Expected behaviour:** the two callers serialize on the per-work-item
  lease. The second caller observes `acquired: false` and surfaces a
  `ConflictException`; the first caller's lease guards its link
  write-up through the lifecycle event projection.
- **Target test case (Milestone 6):** `requestWorkItemRun › serializes
  concurrent dispatch and review-decision calls on the same work item`.

### F3 — Interleaved lifecycle-projection `linkWorkItemRunFromLifecycleEvent`

- **Mutators interleaved:** M1 (request) + M3 (lifecycle projection).
- **Current behaviour:** the lifecycle consumer is a stream-driven
  background worker. It calls `linkRunIfUnlinked` on
  `core.workflow.run.started` events. If the consumer wins the race, the
  work item's `linked_run_id` is the *Core-initiated* run id, and the
  subsequent kanban-side `requestWorkItemRun` caller's conditional UPDATE
  matches zero rows — throwing a `ConflictException` *after* Core has
  already accepted a second (kanban-initiated) run. Two runs are now
  linked to the same work item, with the kanban-initiated one being the
  orphan.
- **Expected behaviour:** the lifecycle projection participates in the
  per-work-item lease protocol (acquires the lease before its
  `linkRunIfUnlinked` call, releasing on completion). The kanban-side
  `requestWorkItemRun` caller either wins the lease and proceeds
  end-to-end, or loses the lease and surfaces a `ConflictException`
  *before* invoking Core — never after.
- **Target test case (Milestone 6):** `linkWorkItemRunFromLifecycleEvent
  › participates in the per-work-item lease protocol`. This scenario's
  Milestone 6 test lives in `core-lifecycle-stream.consumer.spec.ts`
  because the mutator is the lifecycle consumer.

### F4 — Interleaved `DispatchService.linkAcceptedRun`

- **Mutators interleaved:** M1 (request) + M4 (dispatch cycle).
- **Current behaviour:** the dispatch cycle reads the work item, asks
  Core to launch a run, then calls `linkRunIfUnlinked`. The
  `requestWorkItemRun` caller does the same on the user-action path.
  The two paths share the conditional UPDATE as the only barrier, so
  whichever wins commits first; the loser throws `ConflictException`
  *after* Core has accepted a second run. The orphaned run is invisible
  to kanban-side reconciliation.
- **Expected behaviour:** the dispatch cycle's `linkAcceptedRun`
  acquires the per-work-item lease before its `linkRunIfUnlinked` call.
  The user-action `requestWorkItemRun` caller either wins the lease and
  proceeds, or loses the lease and surfaces a `ConflictException`
  *before* invoking Core.
- **Target test case (Milestone 6):** `DispatchService.linkAcceptedRun
  › serializes with concurrent requestWorkItemRun`. This scenario's
  Milestone 6 test lives in `dispatch.service.spec.ts` because the
  mutator is the dispatch service.

### F5 — Interleaved `dispatchSelectedWorkItems.linkAcceptedRun`

- **Mutators interleaved:** M1 (request) + M5 (batch dispatch).
- **Current behaviour:** the batch dispatch path has the same
  conditional-UPDATE-only barrier as M4. The partial-write window
  applies identically: a losing caller has already invoked Core and the
  accepted run is orphaned. The batch path also wraps the failure in an
  `AcceptedRunLinkError` to surface it as a `dispatch_failed` skip, but
  the orphan run still exists in Core and is invisible to kanban-side
  reconciliation.
- **Expected behaviour:** the batch dispatch path's `linkAcceptedRun`
  acquires the per-work-item lease before its `linkRunIfUnlinked` call.
  Conflict paths surface a `ConflictException` (or
  `AcceptedRunLinkError` for the batch envelope) *before* invoking Core.
- **Target test case (Milestone 6):**
  `dispatchSelectedWorkItems.linkAcceptedRun › serializes with concurrent
  requestWorkItemRun`. This scenario's Milestone 6 test lives in
  `dispatch-selected-work-items.spec.ts` because the mutator is the
  batch dispatch path.

### F6 — Partial writes when `linkRunIfUnlinked` returns `false`

- **Mutators interleaved:** M1 (single caller, no concurrency) + M6
  (the partial-write window inside the same call).
- **Current behaviour:** `requestWorkItemRun` calls
  `requestWorkflowRun` first, then `linkRunIfUnlinked`. The link can
  return `false` for three reasons:
  1. A concurrent mutator (M2/M3/M4/M5) won the race.
  2. A *previous* call left the work item in a state where
     `linked_run_id` is non-null (e.g. a reconciliation already
     populated it, or a partial write from a crashed prior call).
  3. The work item's `current_execution_id` is non-null but
     `linked_run_id` is null (an inconsistent state the schema permits).
  In all three cases the current code throws
  `ConflictException("Work item ... is already linked to a workflow run")`
  *after* Core has accepted the run. The accepted run is now an orphan
  that no kanban-side mechanism can re-link, because the
  `linkRunIfUnlinked` guard is the only writer of the link columns.
- **Expected behaviour:** with the per-work-item lease acquired before
  the Core call, cases (1) and (2) cannot occur — the lease is held
  for the duration of the link path, and a concurrent mutator would
  have failed the lease acquisition. Case (3) is detected at the top
  of `requestWorkItemRun` (the work item is already in a
  "linked-but-not-current-execution" state, which is a different
  invariant violation) and surfaces a `ConflictException` *before* Core
  is invoked.
- **Target test case (Milestone 6):** `requestWorkItemRun › fails
  before invoking Core when the work item is already linked`.

## Test-plan cross-reference (Milestone 6)

Each scenario above maps to a target test case in Milestone 6. The
mapping is authoritative; new test cases added in later milestones must
either extend this list or supersede an entry with an explicit note.

| Scenario | Target test case | Test file |
| --- | --- | --- |
| F1 | `requestWorkItemRun › rejects second dispatchWorkItem call when per-work-item lease is held` | `work-item.service.race.spec.ts` |
| F2 | `requestWorkItemRun › serializes concurrent dispatch and review-decision calls on the same work item` | `work-item.service.race.spec.ts` |
| F3 | `linkWorkItemRunFromLifecycleEvent › participates in the per-work-item lease protocol` | `core/core-lifecycle-stream.consumer.spec.ts` |
| F4 | `DispatchService.linkAcceptedRun › serializes with concurrent requestWorkItemRun` | `dispatch/dispatch.service.spec.ts` |
| F5 | `dispatchSelectedWorkItems.linkAcceptedRun › serializes with concurrent requestWorkItemRun` | `dispatch/dispatch-selected-work-items.spec.ts` |
| F6 | `requestWorkItemRun › fails before invoking Core when the work item is already linked` | `work-item.service.race.spec.ts` |

## Acceptance criteria satisfied

- **AC-1:** six failure-mode scenarios enumerated (F1–F6).
- **AC-2:** current vs expected behaviour recorded for each scenario.
- **AC-4:** test plan in Milestone 6 references each scenario via the
  table above.
