import { describe, expect, it, vi, afterEach } from "vitest";
import type { InternalToolExecutionContext } from "@nexus/core";
import { ControlPlaneBoardService } from "../../../orchestration/control-plane/control-plane-board.service";
import { ControlPlaneBoardTool } from "./control-plane-board.tool";
import * as ReadTools from "./index";

describe("ControlPlaneBoardTool", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("exposes the kanban control-plane board read tool definition", () => {
    const tool = new ControlPlaneBoardTool({
      getProjectBoard: vi.fn(),
    } as unknown as ControlPlaneBoardService);

    expect(tool.getName()).toBe("kanban.control_plane_board");
    expect(tool.getDefinition()).toMatchObject({
      name: "kanban.control_plane_board",
      tierRestriction: 2,
      transport: "runner_local",
      runtimeOwner: "runner",
    });
    expect(
      tool.getDefinition().inputSchema.safeParse({ project_id: "p1" }).success,
    ).toBe(true);
  });

  it("returns the same board shape as the board service", async () => {
    const board = {
      projectId: "project-1",
      generatedAt: "2026-05-18T20:00:00.000Z",
      lanes: [],
      facts: [],
      noLaunchReasons: [],
      staleLinks: [],
    };
    const service = { getProjectBoard: vi.fn().mockResolvedValue(board) };
    const tool = new ControlPlaneBoardTool(
      service as unknown as ControlPlaneBoardService,
    );

    await expect(
      tool.execute(
        {},
        {
          project_id: "project-1",
        },
      ),
    ).resolves.toBe(board);
    expect(service.getProjectBoard).toHaveBeenCalledWith("project-1");
  });

  it("derives project_id from context.scopeId when omitted", async () => {
    const board = {
      projectId: "project-from-context",
      generatedAt: "2026-05-18T20:00:00.000Z",
      lanes: [],
      facts: [],
      noLaunchReasons: [],
      staleLinks: [],
    };
    const service = { getProjectBoard: vi.fn().mockResolvedValue(board) };
    const tool = new ControlPlaneBoardTool(
      service as unknown as ControlPlaneBoardService,
    );

    await expect(
      tool.execute({ scopeId: "project-from-context" }, {}),
    ).resolves.toBe(board);
    expect(service.getProjectBoard).toHaveBeenCalledWith(
      "project-from-context",
    );
  });

  it("is exported for KanbanMcpModule auto-registration", () => {
    expect(ReadTools.ControlPlaneBoardTool).toBe(ControlPlaneBoardTool);
  });
});
