import { useMemo } from "react";
import { WorkItem } from "@/lib/api/work-items.types";
import type { WorkItemHierarchy } from "./use-work-item-hierarchy.types";

export type { WorkItemHierarchy } from "./use-work-item-hierarchy.types";

/**
 * Derives a parent -> children grouping from a flat list of work items,
 * based on WorkItem.parentWorkItemId. Pure function so it can be reused
 * outside of React (e.g. by useWorkItemHierarchy below).
 */
export function buildWorkItemHierarchy(items: WorkItem[]): WorkItemHierarchy {
  const idsInList = new Set(items.map((item) => item.id));
  const roots: WorkItem[] = [];
  const childrenByParentId: Record<string, WorkItem[]> = {};

  for (const item of items) {
    const parentId = item.parentWorkItemId;
    if (parentId && idsInList.has(parentId)) {
      (childrenByParentId[parentId] ??= []).push(item);
    } else {
      roots.push(item);
    }
  }

  return { roots, childrenByParentId };
}

/** Memoized hook wrapper around buildWorkItemHierarchy for use in components. */
export function useWorkItemHierarchy(items: WorkItem[]): WorkItemHierarchy {
  return useMemo(() => buildWorkItemHierarchy(items), [items]);
}
