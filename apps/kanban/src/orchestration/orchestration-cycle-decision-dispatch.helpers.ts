import { findTargetBranchBlocker } from "./orchestration-branch-blockers";
import type { BranchBlockerWorkItem } from "./orchestration-branch-blockers.types";
import { filterDispatchableTodo } from "../work-item/work-item-dispatchable.helper";

/**
 * Helpers that decide whether a project has dispatchable todo work
 * remaining, so the cycle decision service can reject a `pause` /
 * `complete` / `blocked` decision that would otherwise drop ready work
 * on the floor. The repo-touching call is injected via the
 * `workItemsRepo` parameter (no repository class is imported here).
 *
 * Extracted from `orchestration-cycle-decision.service.ts` to keep that
 * service under the repository's `max-lines` lint rule.
 *
 * Work item: 2b8d0c51-ad27-4f10-9448-38502c8bbf35 (EPIC-117 / EPIC-202).
 */

type WorkItemRecordShape = Record<string, unknown>;

export async function hasDispatchableTodoWork(args: {
  readonly workItems: unknown[];
  readonly workItemsRepo: {
    findDependenciesByWorkItemIds(ids: string[]): Promise<unknown[]>;
  };
}): Promise<boolean> {
  const { workItems, workItemsRepo } = args;

  const itemRecords = workItems.filter(
    (item): item is WorkItemRecordShape =>
      item !== null && typeof item === "object",
  );
  const workItemIds = itemRecords
    .map((item) => item.id)
    .filter((id): id is string => typeof id === "string");
  const dependencyIdsByItem = groupDependencyIds(
    await workItemsRepo.findDependenciesByWorkItemIds(workItemIds),
  );
  const itemById = new Map(
    itemRecords
      .map(
        (item) => [typeof item.id === "string" ? item.id : null, item] as const,
      )
      .filter(
        (entry): entry is readonly [string, WorkItemRecordShape] =>
          entry[0] !== null,
      ),
  );
  const dispatchableTodoIds = new Set(
    filterDispatchableTodo(
      itemRecords.map((item) => ({
        id: typeof item.id === "string" ? item.id : "",
        status: typeof item.status === "string" ? item.status : "",
        type: typeof item.type === "string" ? item.type : "story",
        parent_work_item_id:
          typeof item.parent_work_item_id === "string"
            ? item.parent_work_item_id
            : null,
      })),
    ).map((item) => item.id),
  );

  return itemRecords.some((item) => {
    if (typeof item.id !== "string" || !dispatchableTodoIds.has(item.id)) {
      return false;
    }
    if (
      typeof item.linked_run_id === "string" &&
      item.linked_run_id.trim().length > 0
    ) {
      return false;
    }
    if (
      typeof item.current_execution_id === "string" &&
      item.current_execution_id.trim().length > 0
    ) {
      return false;
    }
    if (
      findTargetBranchBlocker(
        item as BranchBlockerWorkItem,
        itemRecords as BranchBlockerWorkItem[],
      )
    ) {
      return false;
    }

    const dependencyIds =
      typeof item.id === "string"
        ? (dependencyIdsByItem.get(item.id) ?? readDependencyIds(item))
        : readDependencyIds(item);

    return dependencyIds.every(
      (dependencyId) => itemById.get(dependencyId)?.status === "done",
    );
  });
}

function groupDependencyIds(dependencies: unknown[]): Map<string, string[]> {
  const dependencyIdsByItem = new Map<string, string[]>();

  for (const dependency of dependencies) {
    if (!dependency || typeof dependency !== "object") continue;

    const record = dependency as Record<string, unknown>;
    if (
      typeof record.work_item_id !== "string" ||
      typeof record.depends_on_work_item_id !== "string"
    ) {
      continue;
    }

    const existing = dependencyIdsByItem.get(record.work_item_id) ?? [];
    existing.push(record.depends_on_work_item_id);
    dependencyIdsByItem.set(record.work_item_id, existing);
  }

  return dependencyIdsByItem;
}

function readDependencyIds(item: Record<string, unknown>): string[] {
  return [
    ...readStringArray(item.dependencyIds),
    ...readStringArray(item.dependency_ids),
    ...readStringArray(item.dependsOn),
  ];
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}
