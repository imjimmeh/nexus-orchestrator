import { describe, expect, it } from "vitest";
import {
  WORK_ITEM_STATUS_GROUPS,
  WorkItemStatusSchema,
  isWorkItemStatusInGroup,
} from "./work-item.schema";

describe("WORK_ITEM_STATUS_GROUPS", () => {
  it("contains only valid work item statuses", () => {
    for (const statuses of Object.values(WORK_ITEM_STATUS_GROUPS)) {
      for (const status of statuses) {
        expect(WorkItemStatusSchema.safeParse(status).success).toBe(true);
      }
    }
  });

  it("classifies active/completed/blocked statuses consistently", () => {
    expect(isWorkItemStatusInGroup("refinement", "active")).toBe(true);
    expect(isWorkItemStatusInGroup("in-review", "active")).toBe(true);

    expect(isWorkItemStatusInGroup("ready-to-merge", "completed")).toBe(true);
    expect(isWorkItemStatusInGroup("done", "completed")).toBe(true);

    expect(isWorkItemStatusInGroup("blocked", "blocked")).toBe(true);
    expect(isWorkItemStatusInGroup("todo", "active")).toBe(false);
  });
});
