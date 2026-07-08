import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { InitiativeUpdateStatusTool } from "./initiative-update-status.tool";
import { InitiativeUpdateTool } from "./initiative-update.tool";

const context = {} as InternalToolExecutionContext;

describe("InitiativeUpdateTool", () => {
  it("delegates to updateInitiative", async () => {
    const service = {
      updateInitiative: vi.fn().mockResolvedValue({ id: "i1" }),
    };
    const tool = new InitiativeUpdateTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_update");
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      title: "Renamed",
    });
    expect(service.updateInitiative).toHaveBeenCalledWith(
      "p1",
      "i1",
      expect.objectContaining({ title: "Renamed" }),
    );
  });
});

describe("InitiativeUpdateStatusTool", () => {
  it("delegates to updateStatus", async () => {
    const service = { updateStatus: vi.fn().mockResolvedValue({ id: "i1" }) };
    const tool = new InitiativeUpdateStatusTool(
      service as unknown as InitiativesService,
    );
    expect(tool.getName()).toBe("kanban.initiative_update_status");
    await tool.execute(context, {
      project_id: "p1",
      initiative_id: "i1",
      status: "active",
    });
    expect(service.updateStatus).toHaveBeenCalledWith("p1", "i1", {
      status: "active",
    });
  });
});
