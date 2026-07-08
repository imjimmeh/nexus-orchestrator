import { isNonAutoWakeDecision } from "./orchestration-decision-log.utils";
import type {
  CycleDecision,
  OrchestrationPersistenceRecord,
} from "./orchestration-internal.types";
import type { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { hasImportedRepoContext } from "./orchestration-cycle-decision-imported-repo.helpers";
import { hasDispatchableTodoWork } from "./orchestration-cycle-decision-dispatch.helpers";

/**
 * Resolves the "safe" cycle decision — i.e. the requested cycle decision
 * after the orchestrator's safety guards have rejected premature
 * `complete` decisions on imported-repo projects with no work items, and
 * rejected `pause` / `complete` / `blocked` decisions when dispatchable
 * todo work remains.
 *
 * This helper is the only one in the cycle-decision helper layer that
 * takes a `KanbanWorkItemRepository` directly, because it must call
 * `findByproject_id` to load the project's current work items.
 *
 * Extracted from `orchestration-cycle-decision.service.ts` to keep that
 * service under the repository's `max-lines` lint rule.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202).
 */

export async function resolveSafeCycleDecision(args: {
  readonly projectId: string;
  readonly existing: OrchestrationPersistenceRecord;
  readonly requestedDecision: CycleDecision;
  readonly reason: string;
  readonly workItems: KanbanWorkItemRepository;
}): Promise<{ decision: CycleDecision; reason: string }> {
  const { projectId, existing, requestedDecision, reason, workItems } = args;

  let workItemsList: unknown[] | undefined;

  if (requestedDecision === "complete") {
    const hasGoals = existing.goals.trim().length > 0;
    if (hasGoals && hasImportedRepoContext(existing.metadata)) {
      workItemsList = await workItems.findByproject_id(projectId);

      if (workItemsList.length === 0) {
        return {
          decision: "blocked",
          reason: `Rejected premature complete decision: imported repository has persisted goals but zero Kanban work items. Original reason: ${reason}`,
        };
      }
    }
  }

  if (isNonAutoWakeDecision(requestedDecision)) {
    workItemsList ??= await workItems.findByproject_id(projectId);
    if (
      await hasDispatchableTodoWork({
        workItems: workItemsList,
        workItemsRepo: workItems,
      })
    ) {
      return {
        decision: "repeat",
        reason: `Rejected ${requestedDecision} decision: dispatchable todo work remains. Original reason: ${reason}`,
      };
    }
  }

  return { decision: requestedDecision, reason };
}