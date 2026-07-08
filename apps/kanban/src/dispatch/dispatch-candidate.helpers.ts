import type {
  DependencyRecord,
  WorkItemRecord,
} from "./dispatch-internal.types";
import type { DispatchResult } from "./dispatch.service.types";

export function wasCoreStatusUnavailable(
  item: WorkItemRecord,
  result: DispatchResult,
): boolean {
  return result.skipped.some(
    (entry) =>
      entry.workItemId === item.id &&
      entry.reason === "core_status_unavailable",
  );
}

/**
 * Records an idempotent dispatch for an item that already carries a linked run,
 * returning true when the candidate has been handled and should be skipped by
 * the caller.
 */
export function recordAlreadyLinkedDispatch(
  item: WorkItemRecord,
  result: DispatchResult,
): boolean {
  if (!item.linked_run_id) return false;
  result.dispatched.push({
    workItemId: item.id,
    runId: item.linked_run_id,
    linkedRunId: item.linked_run_id,
    currentExecutionId: item.current_execution_id ?? null,
    status: item.status,
    idempotent: true,
    mutationConfirmed: true,
  });
  return true;
}

/**
 * Decides whether `item` already exhausts its per-agent concurrency budget.
 *
 * Accepts a structural input so the ready-dispatch (`DispatchReadyWorkItemsInput`)
 * and selected-dispatch (`DispatchSelectedWorkItemsInput`) call sites can share
 * the helper without aliasing their inputs.
 */
export function agentCapacityReached(
  input: { maxConcurrentPerAgent?: number },
  item: WorkItemRecord,
  activeByAgent: Map<string, number>,
): boolean {
  const agentId = item.assigned_agent_id;
  if (!agentId || input.maxConcurrentPerAgent === undefined) return false;
  return (activeByAgent.get(agentId) ?? 0) >= input.maxConcurrentPerAgent;
}

export function incrementActiveAgentCount(
  item: WorkItemRecord,
  activeByAgent: Map<string, number>,
): void {
  const agentId = item.assigned_agent_id;
  if (agentId)
    activeByAgent.set(agentId, (activeByAgent.get(agentId) ?? 0) + 1);
}

export function groupDependencyIds(
  dependencies: DependencyRecord[],
): Map<string, string[]> {
  const grouped = new Map<string, string[]>();
  for (const dependency of dependencies) {
    const entries = grouped.get(dependency.work_item_id) ?? [];
    entries.push(dependency.depends_on_work_item_id);
    grouped.set(dependency.work_item_id, entries);
  }
  return grouped;
}

export function dependenciesReady(
  item: WorkItemRecord,
  dependencyIdsByItem: Map<string, string[]>,
  itemById: Map<string, WorkItemRecord>,
): boolean {
  const dependencyIds = dependencyIdsByItem.get(item.id) ?? [];
  return dependencyIds.every((dependencyId) => {
    const dependency = itemById.get(dependencyId);
    return dependency?.status === "done";
  });
}

/**
 * Counts the in-flight work items, per agent, that consume the per-agent
 * concurrency budget.
 *
 * Note: this filter is intentionally narrower than `ownsTargetBranch` in
 * `./target-branch-claims`. `ownsTargetBranch` reports every item that
 * currently occupies a branch slot — including items in
 * `ready-to-merge` or `awaiting-pr-merge` that already finished their run and
 * are merely waiting on merge/CI. The per-agent concurrency budget must
 * reflect items that have an *active dispatched run* consuming the agent's
 * slots (i.e. `linked_run_id` is set), so that newly finished-but-not-yet-merged
 * items do not block fresh dispatches under the same agent. Items without a
 * `linked_run_id` are branch-owners but do not count against the concurrency
 * budget for new dispatches, which is why this helper keys only on
 * `linked_run_id` rather than re-encoding the full `ownsTargetBranch`
 * predicate.
 */
export function countActiveLinkedByAgent(
  items: WorkItemRecord[],
): Map<string, number> {
  const activeByAgent = new Map<string, number>();
  for (const item of items) {
    if (!item.assigned_agent_id || !item.linked_run_id) continue;
    activeByAgent.set(
      item.assigned_agent_id,
      (activeByAgent.get(item.assigned_agent_id) ?? 0) + 1,
    );
  }
  return activeByAgent;
}
