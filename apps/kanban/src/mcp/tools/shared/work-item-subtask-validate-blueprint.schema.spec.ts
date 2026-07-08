import { describe, expect, it } from "vitest";
import { WorkItemSubtaskValidateBlueprintSchema } from "./schemas";

describe("WorkItemSubtaskValidateBlueprintSchema", () => {
  const validBlueprint = [
    {
      subtask_id: "st-1",
      title: "Set up database migration",
      order_index: 0,
      depends_on_subtask_ids: [] as string[],
    },
    {
      subtask_id: "st-2",
      title: "Implement query planner",
      order_index: 1,
      depends_on_subtask_ids: ["st-1"],
    },
  ];

  it("accepts a well-formed blueprint with all required fields", () => {
    const result = WorkItemSubtaskValidateBlueprintSchema.safeParse({
      project_id: "proj-1",
      workItemId: "wi-1",
      blueprint: validBlueprint,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty-string array elements (the 70e3492d failure mode)", () => {
    const result = WorkItemSubtaskValidateBlueprintSchema.safeParse({
      project_id: "proj-1",
      workItemId: "wi-1",
      blueprint: ["", "", "", ""],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blueprint item missing subtask_id", () => {
    const result = WorkItemSubtaskValidateBlueprintSchema.safeParse({
      project_id: "proj-1",
      workItemId: "wi-1",
      blueprint: [
        {
          title: "Missing subtask_id",
          order_index: 0,
          depends_on_subtask_ids: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blueprint item missing order_index", () => {
    const result = WorkItemSubtaskValidateBlueprintSchema.safeParse({
      project_id: "proj-1",
      workItemId: "wi-1",
      blueprint: [
        {
          subtask_id: "st-1",
          title: "Missing order_index",
          depends_on_subtask_ids: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a blueprint item with non-integer order_index", () => {
    const result = WorkItemSubtaskValidateBlueprintSchema.safeParse({
      project_id: "proj-1",
      workItemId: "wi-1",
      blueprint: [
        {
          subtask_id: "st-1",
          title: "Bad order_index",
          order_index: "zero",
          depends_on_subtask_ids: [],
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
