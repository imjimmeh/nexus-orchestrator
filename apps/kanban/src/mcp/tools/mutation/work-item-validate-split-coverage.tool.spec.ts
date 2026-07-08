import type { InternalToolExecutionContext } from "@nexus/core";
import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { WorkItemValidateSplitCoverageTool } from "./work-item-validate-split-coverage.tool";

describe("WorkItemValidateSplitCoverageTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  const tool = new WorkItemValidateSplitCoverageTool();

  it("exposes the kanban coverage-validation tool name", () => {
    expect(tool.getName()).toBe("kanban.work_item_validate_split_coverage");
    expect(tool.getDefinition().name).toBe(
      "kanban.work_item_validate_split_coverage",
    );
  });

  it("passes when children cover every parent AC exactly once", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "parent-1",
      parent_ac_ids: ["AC-1", "AC-2", "AC-3"],
      child_ac_assignments: [
        { child_ref: "child-a", ac_ids: ["AC-1", "AC-2"] },
        { child_ref: "child-b", ac_ids: ["AC-3"] },
      ],
    });
    expect(result).toEqual({ ok: true, coveredCount: 3 });
  });

  it("fails when a parent AC is dropped", async () => {
    let error: unknown;
    try {
      await tool.execute(context, {
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1", "AC-2", "AC-3"],
        child_ac_assignments: [
          { child_ref: "child-a", ac_ids: ["AC-1", "AC-2"] },
        ],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const resp = (error as BadRequestException).getResponse();
    expect(typeof resp).toBe("object");
    expect((resp as { message: string[] }).message).toContain(
      "uncovered parent acceptance criteria: AC-3",
    );
  });

  it("fails when an AC is assigned to more than one child", async () => {
    let error: unknown;
    try {
      await tool.execute(context, {
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1", "AC-2"],
        child_ac_assignments: [
          { child_ref: "child-a", ac_ids: ["AC-1", "AC-2"] },
          { child_ref: "child-b", ac_ids: ["AC-2"] },
        ],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const resp = (error as BadRequestException).getResponse();
    expect(typeof resp).toBe("object");
    expect((resp as { message: string[] }).message).toContain(
      "duplicated across children: AC-2",
    );
  });

  it("fails when a child references an unknown AC", async () => {
    let error: unknown;
    try {
      await tool.execute(context, {
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1"],
        child_ac_assignments: [
          { child_ref: "child-a", ac_ids: ["AC-1", "AC-9"] },
        ],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    const resp = (error as BadRequestException).getResponse();
    expect(typeof resp).toBe("object");
    expect((resp as { message: string[] }).message).toContain(
      "unknown acceptance criteria not on the parent: AC-9",
    );
  });

  it("rejects the BadRequestException type for violations", async () => {
    let error: unknown;
    try {
      await tool.execute(context, {
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1"],
        child_ac_assignments: [],
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(BadRequestException);
  });

  it("rejects an AC duplicated across children with the exact message shape", async () => {
    await expect(
      tool.execute(context, {
        project_id: "project-1",
        workItemId: "wi-1",
        parent_ac_ids: ["AC-1", "AC-2"],
        child_ac_assignments: [
          { child_ref: "c1", ac_ids: ["AC-1", "AC-2"] },
          { child_ref: "c2", ac_ids: ["AC-1", "AC-2"] },
        ],
      }),
    ).rejects.toThrow(
      "Split coverage validation failed for wi-1: acceptance criteria duplicated across children: AC-1, AC-2",
    );
  });

  describe("inputSchema XML-array artifact coercion", () => {
    const schema = tool.getDefinition().inputSchema;

    type ParsedParams = Parameters<typeof tool.execute>[1];

    it("coerces single-element { item } ac_ids and validates coverage", () => {
      const parsed = schema.safeParse({
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1", "AC-2", "AC-3"],
        child_ac_assignments: [
          { child_ref: "child-1", ac_ids: { item: "AC-1" } },
          { child_ref: "child-2", ac_ids: { item: "AC-2" } },
          { child_ref: "child-3", ac_ids: ["AC-3"] },
        ],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const data = parsed.data as ParsedParams;
        expect(data.child_ac_assignments).toEqual([
          { child_ref: "child-1", ac_ids: ["AC-1"] },
          { child_ref: "child-2", ac_ids: ["AC-2"] },
          { child_ref: "child-3", ac_ids: ["AC-3"] },
        ]);
      }
    });

    it("coerces a single-element { item } parent_ac_ids", () => {
      const parsed = schema.safeParse({
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: { item: "AC-1" },
        child_ac_assignments: [{ child_ref: "child-1", ac_ids: ["AC-1"] }],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const data = parsed.data as ParsedParams;
        expect(data.parent_ac_ids).toEqual(["AC-1"]);
      }
    });

    it("end-to-end: parsed artifact input passes coverage validation", async () => {
      const parsed = schema.safeParse({
        project_id: "project-1",
        workItemId: "parent-1",
        parent_ac_ids: ["AC-1", "AC-2"],
        child_ac_assignments: [
          { child_ref: "child-1", ac_ids: { item: "AC-1" } },
          { child_ref: "child-2", ac_ids: { item: "AC-2" } },
        ],
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        const result = await tool.execute(context, parsed.data as ParsedParams);
        expect(result).toEqual({ ok: true, coveredCount: 2 });
      }
    });
  });
});
