import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemFinalizeTriageTool } from "./work-item-finalize-triage.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";

describe("WorkItemFinalizeTriageTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  let updateWorkItemMock: ReturnType<typeof vi.fn>;
  let tool: WorkItemFinalizeTriageTool;

  beforeEach(() => {
    updateWorkItemMock = vi.fn(() => Promise.resolve({}));
    const workItems = {
      updateWorkItem: updateWorkItemMock,
    } as unknown as WorkItemService;
    tool = new WorkItemFinalizeTriageTool(workItems);
  });

  it("has the finalize-triage tool name", () => {
    expect(tool.getName()).toBe("kanban.work_item_finalize_triage");
  });

  it("uses the deterministic track when not ambiguous", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      deterministic_track: "standard",
      ambiguous: false,
    });
    expect(result.track).toBe("standard");
    expect(updateWorkItemMock).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      expect.objectContaining({
        metadata: {
          refinement: { track: "standard" },
        },
      }),
    );
  });

  it("uses the classified track when ambiguous and provided", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      deterministic_track: "trivial",
      ambiguous: true,
      classified_track: "complex",
    });
    expect(result.track).toBe("complex");
    expect(updateWorkItemMock).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      expect.objectContaining({
        metadata: {
          refinement: { track: "complex" },
        },
      }),
    );
  });

  it("falls back to the deterministic track when ambiguous but no classification arrived", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      deterministic_track: "standard",
      ambiguous: true,
    });
    expect(result.track).toBe("standard");
    expect(updateWorkItemMock).toHaveBeenCalledWith(
      "project-1",
      "wi-1",
      expect.objectContaining({
        metadata: {
          refinement: { track: "standard" },
        },
      }),
    );
  });
});
