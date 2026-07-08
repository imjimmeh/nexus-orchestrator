import { describe, expect, it, vi } from "vitest";
import { RetrospectivesController } from "./retrospectives.controller";

describe("RetrospectivesController", () => {
  it("runs a manual retrospective replay with validated transport input", async () => {
    const retrospectives = {
      runManualReplay: vi.fn().mockResolvedValue({ id: "run-1" }),
    };
    const controller = new RetrospectivesController(retrospectives as never);

    await expect(
      controller.run({
        project_id: "project-1",
        orchestration_id: "orch-1",
        trigger_revision_marker: "rev-1",
        replay_of_run_id: "run-0",
        manual_override: true,
      }),
    ).resolves.toEqual({ success: true, data: { id: "run-1" } });

    expect(retrospectives.runManualReplay).toHaveBeenCalledWith({
      project_id: "project-1",
      orchestration_id: "orch-1",
      trigger_revision_marker: "rev-1",
      replay_of_run_id: "run-0",
      manual_override: true,
    });
  });

  it("rejects a manual replay without a project id", async () => {
    const retrospectives = {
      runManualReplay: vi.fn(),
    };
    const controller = new RetrospectivesController(retrospectives as never);

    await expect(controller.run({ manual_override: true })).rejects.toThrow(
      "project_id is required",
    );
    expect(retrospectives.runManualReplay).not.toHaveBeenCalled();
  });

  it("lists retrospective runs with validated query filters", async () => {
    const runs = [
      {
        id: "run-1",
        project_id: "project-1",
        status: "completed",
        trigger_type: "manual_replay",
        candidate_count: 1,
        diagnostics: { emitted_event: "learning.candidate.proposed.v1" },
        delta_snapshot: { workItems: { total: 4 } },
      },
    ];
    const retrospectives = {
      listRuns: vi.fn().mockResolvedValue(runs),
    };
    const controller = new RetrospectivesController(retrospectives as never);

    await expect(
      controller.listRuns({
        project_id: "project-1",
        status: "completed",
        limit: "25",
        offset: "10",
      }),
    ).resolves.toEqual({ success: true, data: runs });

    expect(retrospectives.listRuns).toHaveBeenCalledWith({
      project_id: "project-1",
      status: "completed",
      limit: 25,
      offset: 10,
    });
  });

  it.each([
    ["unknown status", { status: "unknown" }],
    ["blank limit", { limit: "   " }],
    ["non-numeric limit", { limit: "many" }],
    ["negative limit", { limit: "-1" }],
    ["negative offset", { offset: "-1" }],
  ])("rejects invalid list query input: %s", async (_name, query) => {
    const retrospectives = {
      listRuns: vi.fn(),
    };
    const controller = new RetrospectivesController(retrospectives as never);

    await expect(controller.listRuns(query)).rejects.toThrow();
    expect(retrospectives.listRuns).not.toHaveBeenCalled();
  });

  it("returns the latest retrospective status for a project", async () => {
    const status = {
      project_id: "project-1",
      latest_run_timestamp: "2026-05-16T11:59:00.000Z",
      trigger_type: "manual_replay",
      status: "completed",
      candidate_count: 1,
      skipped_reason: null,
      failure_reason: null,
      idempotency_key: "kanban-retrospective:manual_replay:project-1:rev-1",
      diagnostics: { emitted_event: "learning.candidate.proposed.v1" },
      delta_snapshot: { workItems: { total: 4 } },
    };
    const retrospectives = {
      getProjectStatus: vi.fn().mockResolvedValue(status),
    };
    const controller = new RetrospectivesController(retrospectives as never);

    await expect(controller.getProjectStatus("project-1")).resolves.toEqual({
      success: true,
      data: status,
    });

    expect(retrospectives.getProjectStatus).toHaveBeenCalledWith("project-1");
  });
});
