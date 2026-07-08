// apps/web/src/lib/work-items/work-item-filter-options.spec.ts
import { describe, expect, it } from "vitest";
import {
  WORK_ITEM_STATUS_OPTIONS,
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_TYPE_OPTIONS,
} from "./work-item-filter-options";

describe("work item filter options", () => {
  it("exposes every status as a value/label pair", () => {
    expect(WORK_ITEM_STATUS_OPTIONS).toContainEqual({
      value: "in-progress",
      label: "In progress",
    });
    expect(WORK_ITEM_STATUS_OPTIONS).toContainEqual({
      value: "awaiting-pr-merge",
      label: "Awaiting pr merge",
    });
    expect(WORK_ITEM_STATUS_OPTIONS.length).toBe(9);
  });

  it("exposes priority options", () => {
    expect(WORK_ITEM_PRIORITY_OPTIONS.map((o) => o.value)).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  it("exposes every work item type as a value/label pair", () => {
    expect(WORK_ITEM_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "epic",
      "story",
      "task",
      "bug",
      "spike",
    ]);
    expect(WORK_ITEM_TYPE_OPTIONS).toContainEqual({
      value: "epic",
      label: "Epic",
    });
  });
});
