import type { WorkItemType } from "./work-item-type";

const CONTAINER_CAPABLE: ReadonlySet<WorkItemType> = new Set(["epic", "story"]);

const PARENT_TO_CHILDREN: Readonly<
  Record<WorkItemType, ReadonlySet<WorkItemType>>
> = {
  epic: new Set(["story", "task", "bug", "spike"]),
  story: new Set(["task", "bug", "spike"]),
  task: new Set(),
  bug: new Set(),
  spike: new Set(),
};

export function isEpicType(type: WorkItemType): boolean {
  return type === "epic";
}

export function canHaveChildren(type: WorkItemType): boolean {
  return CONTAINER_CAPABLE.has(type);
}

export function canParent(parent: WorkItemType, child: WorkItemType): boolean {
  if (child === "epic") return false;
  return PARENT_TO_CHILDREN[parent].has(child);
}

export function allowsStoryPoints(type: WorkItemType): boolean {
  return type !== "epic";
}

export function isDispatchable(
  type: WorkItemType,
  hasChildren: boolean,
): boolean {
  return type !== "epic" && !hasChildren;
}
