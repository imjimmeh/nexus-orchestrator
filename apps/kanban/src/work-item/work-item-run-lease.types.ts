/**
 * Public input type for `WorkItemRunLeaseService.acquireRunLease`.
 *
 * Lives in a dedicated `.types.ts` file per the project's
 * `no-restricted-syntax` lint rule, which forbids exporting interfaces
 * from the service module itself. The `action` is constrained to the
 * work-item lifecycle transitions that participate in the same
 * `(project_id, work_item_id)` lease protocol documented in
 * `docs/architecture/ADR-20260623-work-item-run-link-lease.md`:
 *
 * - `dispatch` / `review` / `merge` are the three user-visible
 *   transitions that go through `WorkItemService.requestWorkItemRun`.
 * - `lifecycle_link` is the lifecycle-projection link performed by
 *   `CoreLifecycleStreamConsumerService.linkWorkItemRunFromLifecycleEvent`.
 *   Adding `lifecycle_link` closes the F2/F4 boundary described in the
 *   work-item README: the projection link now acquires the same per-work-item
 *   lease as the dispatch funnel, so the conditional `linkRunIfUnlinked`
 *   UPDATE is no longer the only race-safety barrier on the projection
 *   path.
 * - `dispatch_selected` is the lease action used by the two
 *   `DispatchService.linkAcceptedRun` paths — the
 *   `dispatchReadyWorkItems` funnel and the
 *   `dispatchSelectedWorkItems` batch path — to serialize their
 *   `coreClient.requestWorkflowRun` → `linkRunIfUnlinked` →
 *   status-projection sequence against any concurrent writer on the same
 *   `(project_id, work_item_id)` tuple. The action is encoded in the
 *   owner id only (the conflict key is `work_item_dispatch:{project}:{wi}`
 *   for every action), so a holder from any action blocks the dispatch
 *   funnel and the dispatch funnel blocks every other holder — this is
 *   the F1/F2/F4 closure documented in the ADR.
 *
 * Widening the union here is a deliberate protocol change and must be
 * paired with a milestone-level review of the race-safety boundary.
 */
export interface AcquireWorkItemRunLeaseServiceInput {
  readonly projectId: string;
  readonly workItemId: string;
  readonly action:
    | "dispatch"
    | "review"
    | "merge"
    | "lifecycle_link"
    | "dispatch_selected";
  readonly ownerId: string;
  readonly ttlMs?: number;
}
