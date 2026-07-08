import { WorkItem } from "@/lib/api/work-items.types";
import type {
  SplitRelationshipRow,
  SplitRelationshipView,
} from "./work-item-split-relationships.types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function getSplitRecord(
  metadata: unknown,
): Record<string, unknown> | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.split)) {
    return undefined;
  }

  return metadata.split;
}

function getSplitParentId(metadata: unknown): string | undefined {
  const canonicalParentId = nonEmptyString(getSplitRecord(metadata)?.parentId);
  if (canonicalParentId) {
    return canonicalParentId;
  }

  return isRecord(metadata)
    ? nonEmptyString(metadata.parent_context_id)
    : undefined;
}

function getSplitChildIds(metadata: unknown): string[] {
  const proposedChildIds = getSplitRecord(metadata)?.proposedChildIds;
  if (!Array.isArray(proposedChildIds)) {
    return [];
  }

  return proposedChildIds.filter(
    (value): value is string => typeof value === "string",
  );
}

function getSourceId(item: WorkItem): string | undefined {
  return isRecord(item.metadata)
    ? nonEmptyString(item.metadata.sourceId)
    : undefined;
}

function createRelationshipRow(
  itemId: string,
  allItems: WorkItem[],
): SplitRelationshipRow {
  return {
    id: itemId,
    item: allItems.find(
      (item) => item.id === itemId || getSourceId(item) === itemId,
    ),
  };
}

export function getSplitRelationshipView(
  item: WorkItem,
  allItems: WorkItem[],
): SplitRelationshipView {
  const parentId = getSplitParentId(item.metadata);
  const children = getSplitChildIds(item.metadata).map((childId) =>
    createRelationshipRow(childId, allItems),
  );

  return {
    parent: parentId ? createRelationshipRow(parentId, allItems) : undefined,
    children,
    childrenDone: children.filter((child) => child.item?.status === "done")
      .length,
    childrenTotal: children.length,
  };
}
