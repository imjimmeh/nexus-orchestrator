import { describe, expect, it } from "vitest";
import {
  WORK_ITEM_STATUS_GROUPS,
  WorkItemStatusSchema,
  isWorkItemStatusInGroup,
} from "./work-item.schema";

describe("awaiting-pr-merge status", () => {
  it("is a valid work item status", () => {
    expect(WorkItemStatusSchema.safeParse("awaiting-pr-merge").success).toBe(
      true,
    );
  });

  it("belongs to the completed group, between ready-to-merge and done", () => {
    expect(WORK_ITEM_STATUS_GROUPS.completed).toEqual([
      "ready-to-merge",
      "awaiting-pr-merge",
      "done",
    ]);
    expect(isWorkItemStatusInGroup("awaiting-pr-merge", "completed")).toBe(
      true,
    );
  });

  it("is not in the active or blocked groups", () => {
    expect(isWorkItemStatusInGroup("awaiting-pr-merge", "active")).toBe(false);
    expect(isWorkItemStatusInGroup("awaiting-pr-merge", "blocked")).toBe(false);
  });
});
