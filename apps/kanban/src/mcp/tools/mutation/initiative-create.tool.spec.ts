import type { InternalToolExecutionContext } from "@nexus/core";
import { describe, expect, it, vi } from "vitest";
import { InitiativesService } from "../../../initiatives/initiatives.service";
import { InitiativeCreateTool } from "./initiative-create.tool";

describe("InitiativeCreateTool", () => {
  const context = {} as InternalToolExecutionContext;

  it("is named kanban.initiative_create", () => {
    const tool = new InitiativeCreateTool({} as InitiativesService);
    expect(tool.getName()).toBe("kanban.initiative_create");
  });

  it("delegates to InitiativesService.createInitiative with the resolved project id", async () => {
    const service = {
      createInitiative: vi.fn().mockResolvedValue({ id: "i1" }),
    };
    const tool = new InitiativeCreateTool(
      service as unknown as InitiativesService,
    );
    const result = await tool.execute(context, {
      project_id: "p1",
      title: "Harden loop",
      horizon: "now",
    });
    expect(service.createInitiative).toHaveBeenCalledWith(
      "p1",
      expect.objectContaining({ title: "Harden loop", horizon: "now" }),
    );
    expect(result).toEqual({ id: "i1" });
  });

  it("derives project id from context.scopeId when omitted", async () => {
    const service = {
      createInitiative: vi.fn().mockResolvedValue({ id: "i2" }),
    };
    const tool = new InitiativeCreateTool(
      service as unknown as InitiativesService,
    );
    await tool.execute({ scopeId: "ctx-project" }, { title: "From context" });
    expect(service.createInitiative).toHaveBeenCalledWith(
      "ctx-project",
      expect.objectContaining({ title: "From context" }),
    );
  });
});
