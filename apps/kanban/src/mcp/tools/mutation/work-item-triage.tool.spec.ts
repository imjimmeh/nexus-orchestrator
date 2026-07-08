import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemTriageTool } from "./work-item-triage.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";
import type { RejectionHotspotsService } from "../../../orchestration/rejection-hotspots.service";

describe("WorkItemTriageTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  let tool: WorkItemTriageTool;

  beforeEach(() => {
    const workItems = {
      listWorkItems: vi.fn(() =>
        Promise.resolve([
          {
            id: "wi-1",
            description: "Acceptance: AC-1 do thing. AC-2 do other.",
            metadata: null,
          },
        ]),
      ),
    } as unknown as WorkItemService;
    const hotspots = {
      areaRejectionScore: vi.fn(() => Promise.resolve(0)),
    } as unknown as RejectionHotspotsService;
    tool = new WorkItemTriageTool(workItems, hotspots);
  });

  it("has the triage tool name", () => {
    expect(tool.getName()).toBe("kanban.work_item_triage");
  });

  it("returns a track and ambiguity flag derived from the work item", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
    });
    expect(result.track).toBe("trivial");
    expect(result).toHaveProperty("ambiguous");
    expect(result.acCount).toBe(2);
  });

  it("upgrades a trivial item to standard when it touches a rejection hotspot", async () => {
    const workItems = {
      listWorkItems: vi.fn(() =>
        Promise.resolve([
          {
            id: "wi-1",
            description: "AC-1 tiny tweak",
            metadata: null,
            executionConfig: {
              implementationPlan: {
                milestones: [
                  {
                    name: "m",
                    tasks: [
                      { id: "1.1", target_files: ["apps/api/src/hot/x.ts"] },
                    ],
                  },
                ],
              },
            },
          },
        ]),
      ),
    } as unknown as WorkItemService;
    const hotspots = {
      areaRejectionScore: vi.fn(() => Promise.resolve(5)),
    } as unknown as RejectionHotspotsService;
    const t = new WorkItemTriageTool(workItems, hotspots);

    const result = await t.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
    });
    expect(result.track).not.toBe("trivial");
  });
});
