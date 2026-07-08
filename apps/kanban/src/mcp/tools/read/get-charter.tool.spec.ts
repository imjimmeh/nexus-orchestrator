import { describe, expect, it, vi } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { GetCharterTool } from "./get-charter.tool";
import type { CharterDocRenderService } from "../../../project/charter-doc-render.service";

function makeContext(scopeId?: string): InternalToolExecutionContext {
  return { scopeId };
}

describe("GetCharterTool", () => {
  it("exposes the kanban.get_charter definition", () => {
    const render = { render: vi.fn() } as unknown as CharterDocRenderService;
    const tool = new GetCharterTool(render);

    expect(tool.getName()).toBe("kanban.get_charter");
    const definition = tool.getDefinition();
    expect(definition.name).toBe("kanban.get_charter");
    expect(definition.transport).toBe("runner_local");
    expect(definition.runtimeOwner).toBe("runner");
  });

  it("renders the charter for the project resolved from params", async () => {
    const renderFn = vi.fn().mockResolvedValue("# Project Charter\n");
    const render = { render: renderFn } as unknown as CharterDocRenderService;
    const tool = new GetCharterTool(render);

    const result = await tool.execute(makeContext(), {
      project_id: "project-1",
    });

    expect(renderFn).toHaveBeenCalledWith("project-1");
    expect(result).toEqual({ charter: "# Project Charter\n" });
  });

  it("falls back to the context scopeId when project_id is omitted", async () => {
    const renderFn = vi.fn().mockResolvedValue("# Project Charter\n");
    const render = { render: renderFn } as unknown as CharterDocRenderService;
    const tool = new GetCharterTool(render);

    await tool.execute(makeContext("scope-9"), {});

    expect(renderFn).toHaveBeenCalledWith("scope-9");
  });
});
