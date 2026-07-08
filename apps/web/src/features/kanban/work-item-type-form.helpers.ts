import {
  allowsStoryPoints,
  canParent,
  type WorkItemType,
} from "@nexus/kanban-contracts";
import { WorkItem } from "@/lib/api/work-items.types";
import { WORK_ITEM_TYPE_META } from "./work-item-type.constants";
import type {
  WorkItemTypeFieldErrors,
  WorkItemTypeFieldsInput,
} from "./work-item-type-form.helpers.types";

export type {
  WorkItemTypeFieldErrors,
  WorkItemTypeFieldsInput,
} from "./work-item-type-form.helpers.types";

/**
 * Client-side mirror of the parent/points invariants
 * `assertWorkItemInvariants` (apps/kanban/src/work-item/work-item-invariants.ts)
 * enforces server-side, built from the same shared `canParent` /
 * `allowsStoryPoints` predicates (`@nexus/kanban-contracts`) so the two
 * never drift. This lets the create/edit form reject an invalid
 * type/parent/points combination before it ever reaches the API.
 */
export function validateWorkItemTypeFields(
  input: WorkItemTypeFieldsInput,
): WorkItemTypeFieldErrors {
  const errors: WorkItemTypeFieldErrors = {};

  if (
    input.storyPoints !== null &&
    input.storyPoints !== undefined &&
    !allowsStoryPoints(input.type)
  ) {
    errors.storyPoints = `${WORK_ITEM_TYPE_META[input.type].label} items cannot have story points.`;
  }

  if (input.parentType !== null && input.parentType !== undefined) {
    if (input.type === "epic") {
      errors.parentWorkItemId = "An epic cannot have a parent.";
    } else if (!canParent(input.parentType, input.type)) {
      errors.parentWorkItemId = `A ${WORK_ITEM_TYPE_META[input.parentType].label} cannot parent a ${WORK_ITEM_TYPE_META[input.type].label}.`;
    }
  }

  return errors;
}

/**
 * Narrows a flat item list down to the items that are legal parents for
 * `childType`, per the shared `canParent` matrix. Excludes `excludeId` (the
 * item being edited, if any) so an item can never be offered as its own
 * parent.
 */
export function getEligibleParentCandidates(
  items: WorkItem[],
  childType: WorkItemType,
  excludeId?: string,
): WorkItem[] {
  return items.filter(
    (item) => item.id !== excludeId && canParent(item.type, childType),
  );
}
