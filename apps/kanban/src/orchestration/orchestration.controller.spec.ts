import { NotFoundException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { OrchestrationActionRequestsController } from "./orchestration-action-requests.controller";
import { OrchestrationController } from "./orchestration.controller";

describe("OrchestrationController action request reads", () => {
  it("starts orchestration without requiring a client-selected workflow id", async () => {
    const orchestration = {
      start: vi.fn().mockResolvedValue({ id: "orch-1" }),
    };
    const controller = new OrchestrationController(
      orchestration as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.start("project-1", {
        goals: "Build the roadmap",
        orchestration_mode: "supervised",
      }),
    ).resolves.toEqual({ success: true, data: { id: "orch-1" } });

    expect(orchestration.start).toHaveBeenCalledWith("project-1", {
      goals: "Build the roadmap",
      workflowId: undefined,
      requestedBy: undefined,
      orchestrationMode: "supervised",
      sourceContext: undefined,
      readinessContext: undefined,
      startupHints: undefined,
    });
  });

  it("returns project state with null orchestration before orchestration starts", async () => {
    const orchestration = {
      get: vi.fn().mockRejectedValue(new NotFoundException("not started")),
    };
    const workItems = {
      listWorkItems: vi.fn().mockResolvedValue([
        {
          id: "wi-1",
          title: "First item",
          status: "todo",
          priority: "p1",
          dependsOn: [],
        },
      ]),
    };
    const controller = new OrchestrationController(
      orchestration as never,
      workItems as never,
      {} as never,
    );

    await expect(controller.get("project-1")).resolves.toEqual({
      success: true,
      data: {
        orchestration: null,
        projectState: {
          project_id: "project-1",
          totalCount: 1,
          activeCount: 1,
          groupedByStatus: {
            todo: [
              {
                id: "wi-1",
                title: "First item",
                status: "todo",
                priority: "p1",
                dependsOn: [],
                blocks: [],
                blockers: [],
              },
            ],
          },
        },
        pendingActionRequests: [],
      },
    });
  });

  it("returns pending project action requests", async () => {
    const orchestration = {
      listProjectActionRequests: vi.fn().mockResolvedValue([{ id: "req-1" }]),
    };
    const controller = new OrchestrationController(
      orchestration as never,
      {} as never,
      {} as never,
    );

    await expect(controller.pendingActions("project-1")).resolves.toEqual({
      success: true,
      data: [{ id: "req-1" }],
    });
    expect(orchestration.listProjectActionRequests).toHaveBeenCalledWith(
      "project-1",
      "pending",
    );
  });

  it("runs imported hydration recovery for the project", async () => {
    const orchestration = {
      recoverImportedHydration: vi.fn().mockResolvedValue({ id: "orch-1" }),
    };
    const controller = new OrchestrationController(
      orchestration as never,
      {} as never,
      {} as never,
    );

    await expect(
      controller.recoverImportedHydration("project-1"),
    ).resolves.toEqual({
      success: true,
      data: { id: "orch-1" },
    });
    expect(orchestration.recoverImportedHydration).toHaveBeenCalledWith(
      "project-1",
    );
  });

  it("returns global action requests using the requested status filter", async () => {
    const orchestration = {
      listActionRequests: vi.fn().mockResolvedValue([{ id: "req-1" }]),
    };
    const controller = new OrchestrationActionRequestsController(
      orchestration,
    );

    await expect(controller.list("fulfilled")).resolves.toEqual({
      success: true,
      data: [{ id: "req-1" }],
    });
    expect(orchestration.listActionRequests).toHaveBeenCalledWith("fulfilled");
  });
});
