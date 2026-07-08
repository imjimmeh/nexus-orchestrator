import { beforeEach, describe, expect, it, vi } from "vitest";
import { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import { ProbeResultsService } from "./probe-results.service";

type MockKanbanOrchestrationRepository = {
  findByproject_id: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

describe("ProbeResultsService", () => {
  let repository: MockKanbanOrchestrationRepository;
  let service: ProbeResultsService;

  beforeEach(() => {
    repository = {
      findByproject_id: vi.fn(),
      save: vi.fn((value) => Promise.resolve(value)),
    };
    service = new ProbeResultsService(
      repository as unknown as KanbanOrchestrationRepository,
    );
  });

  it("records probe results in orchestration metadata without dropping existing keys", async () => {
    repository.findByproject_id.mockResolvedValue({
      project_id: "project-1",
      goals: "Investigate imported repository",
      mode: "supervised",
      status: "orchestrating",
      linked_run_id: "run-1",
      decision_log: [],
      action_requests: [],
      metadata: { selectedRoute: "imported-repo-bootstrap" },
      created_at: new Date("2026-05-07T17:00:00.000Z"),
      updated_at: new Date("2026-05-07T17:30:00.000Z"),
    });

    const result = await service.recordProbeResult({
      projectId: "project-1",
      probeScopeId: "web-ui",
      outcome: "success",
      result: { inferred_status: "implemented" },
      recordedAt: "2026-05-07T18:00:00.000Z",
    });

    expect(result).toEqual({ ok: true });
    expect(repository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "project-1",
        status: "orchestrating",
        metadata: {
          selectedRoute: "imported-repo-bootstrap",
          probe_results: {
            "web-ui": {
              scope_id: "web-ui",
              outcome: "success",
              result: { inferred_status: "implemented" },
              recorded_at: "2026-05-07T18:00:00.000Z",
            },
          },
        },
      }),
    );
  });

  it("returns a not-found result when orchestration state is missing", async () => {
    repository.findByproject_id.mockResolvedValue(null);

    const result = await service.recordProbeResult({
      projectId: "missing-project",
      probeScopeId: "web-ui",
      outcome: "failed",
      result: { inferred_status: "unknown" },
      recordedAt: "2026-05-07T18:00:00.000Z",
    });

    expect(result).toEqual({
      ok: false,
      reason: "orchestration_not_found",
    });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
