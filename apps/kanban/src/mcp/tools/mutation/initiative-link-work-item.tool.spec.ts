import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { InitiativeLinkWorkItemTool } from "./initiative-link-work-item.tool";

const context = {} as InternalToolExecutionContext;

describe("InitiativeLinkWorkItemTool", () => {
  it("assigns a work item to an initiative", async () => {
    const service = { assignWorkItem: vi.fn().mockResolvedValue(undefined) };
    const tool = new InitiativeLinkWorkItemTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_link_work_item");
    const result = await tool.execute(context, {
      project_id: "p1",
      work_item_id: "w1",
      initiative_id: "i1",
    });
    expect(service.assignWorkItem).toHaveBeenCalledWith("p1", "w1", "i1");
    expect(result).toEqual({
      ok: true,
      work_item_id: "w1",
      initiative_id: "i1",
    });
  });

  it("clears the link when initiative_id is null", async () => {
    const service = { assignWorkItem: vi.fn().mockResolvedValue(undefined) };
    const tool = new InitiativeLinkWorkItemTool(
      service as unknown as InitiativesService,
    );
    const result = await tool.execute(context, {
      project_id: "p1",
      work_item_id: "w1",
      initiative_id: null,
    });
    expect(service.assignWorkItem).toHaveBeenCalledWith("p1", "w1", null);
    expect(result).toEqual({
      ok: true,
      work_item_id: "w1",
      initiative_id: null,
    });
  });
});
