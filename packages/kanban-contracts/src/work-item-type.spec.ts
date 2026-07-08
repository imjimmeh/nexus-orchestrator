import { describe, expect, it } from "vitest";
import {
  WORK_ITEM_TYPES,
  WorkItemTypeSchema,
  STORY_POINT_VALUES,
  StoryPointsSchema,
} from "./schemas/work-item-type";

describe("work item type contract", () => {
  it("enumerates exactly the five types", () => {
    expect([...WORK_ITEM_TYPES]).toEqual([
      "epic",
      "story",
      "task",
      "bug",
      "spike",
    ]);
  });

  it("rejects unknown types", () => {
    expect(WorkItemTypeSchema.safeParse("initiative").success).toBe(false);
    expect(WorkItemTypeSchema.parse("story")).toBe("story");
  });

  it("accepts only Fibonacci story points", () => {
    expect([...STORY_POINT_VALUES]).toEqual([1, 2, 3, 5, 8, 13]);
    for (const v of STORY_POINT_VALUES) {
      expect(StoryPointsSchema.parse(v)).toBe(v);
    }
    expect(StoryPointsSchema.safeParse(4).success).toBe(false);
    expect(StoryPointsSchema.safeParse(0).success).toBe(false);
  });
});
