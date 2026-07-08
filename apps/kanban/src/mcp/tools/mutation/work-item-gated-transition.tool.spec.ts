import type { InternalToolExecutionContext } from "@nexus/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemGatedTransitionTool } from "./work-item-gated-transition.tool";
import type { WorkItemService } from "../../../work-item/work-item.service";
import type { OrchestrationService } from "../../../orchestration/orchestration.service";

describe("WorkItemGatedTransitionTool", () => {
  const context = { scopeId: "project-1" } as InternalToolExecutionContext;
  let updateStatus: ReturnType<typeof vi.fn>;
  let requestAction: ReturnType<typeof vi.fn>;
  let getMode: ReturnType<typeof vi.fn>;
  let tool: WorkItemGatedTransitionTool;

  beforeEach(() => {
    updateStatus = vi.fn(() => Promise.resolve({ id: "wi-1", status: "todo" }));
    requestAction = vi.fn(() => Promise.resolve({ id: "req-1" }));
    getMode = vi.fn(() => "supervised");
    tool = new WorkItemGatedTransitionTool(
      { updateStatus } as never,
      {
        get: () => Promise.resolve({ orchestrationMode: getMode() }),
        requestAction,
      } as never,
    );
  });

  it("transitions directly when mode is autonomous regardless of risk", async () => {
    getMode.mockReturnValue("autonomous");
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "high",
    });
    expect(updateStatus).toHaveBeenCalledWith("project-1", "wi-1", "todo");
    expect(requestAction).not.toHaveBeenCalled();
    expect(result).toMatchObject({ gated: false });
  });

  it("transitions directly for low risk even in supervised mode", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "low",
    });
    expect(updateStatus).toHaveBeenCalled();
    expect(result).toMatchObject({ gated: false });
  });

  it("queues for approval when high risk and supervised", async () => {
    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "high",
    });
    expect(updateStatus).not.toHaveBeenCalled();
    expect(requestAction).toHaveBeenCalled();
    expect(result).toMatchObject({ gated: true });
  });

  it("gates a high-risk transition when autonomy_merge=ask even if mode is autonomous", async () => {
    getMode.mockReturnValue("autonomous");
    requestAction.mockResolvedValueOnce({ id: "req-1" });

    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "high",
      autonomy_merge: "ask",
    });

    expect(result).toMatchObject({ gated: true, actionRequestId: "req-1" });
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it("proceeds on high-risk transition when autonomy_merge=auto even if mode is supervised", async () => {
    updateStatus.mockResolvedValueOnce({ id: "wi-1" });

    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "high",
      autonomy_merge: "auto",
    });

    expect(result).toMatchObject({ gated: false });
    expect(requestAction).not.toHaveBeenCalled();
  });

  it("falls back to mode when autonomy_merge is absent (back-compat)", async () => {
    requestAction.mockResolvedValueOnce({ id: "req-2" });

    const result = await tool.execute(context, {
      project_id: "project-1",
      workItemId: "wi-1",
      target_status: "todo",
      risk_level: "high",
    });

    expect(result).toMatchObject({ gated: true });
  });
});
