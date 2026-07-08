import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import type { KanbanRetrospectiveRunEntity } from "../database/entities/kanban-retrospective-run.entity";
import type { KanbanOrchestrationRepository } from "../database/repositories/kanban-orchestration.repository";
import type { KanbanRetrospectiveRunRepository } from "../database/repositories/kanban-retrospective-run.repository";
import { KanbanRetrospectiveEvidenceService } from "./kanban-retrospective-evidence.service";
import { KanbanRetrospectiveService } from "./kanban-retrospective.service";
import {
  LEARNING_CANDIDATE_PROPOSED_EVENT,
  type KanbanRetrospectiveDeltaSnapshot,
} from "./retrospective.types";

import type { CycleDecisionEventHandler } from "./events/cycle-decision-event.handler";
type MockKanbanOrchestrationRepository = {
  findByproject_id: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
};

type MockKanbanRetrospectiveRunRepository = {
  createRun: ReturnType<typeof vi.fn>;
  findByIdempotencyKey: ReturnType<typeof vi.fn>;
  findLatestCompletedByProject: ReturnType<typeof vi.fn>;
  findLatestByProject: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  markCompleted: ReturnType<typeof vi.fn>;
  markFailed: ReturnType<typeof vi.fn>;
  markSkipped: ReturnType<typeof vi.fn>;
};

type MockKanbanRetrospectiveEvidenceService = {
  collectProjectEvidence: ReturnType<typeof vi.fn>;
};

type MockCoreWorkflowClientService = {
  emitDomainEvent: ReturnType<typeof vi.fn>;
  emitDomainEventOrThrow: ReturnType<typeof vi.fn>;
};

type MockCycleDecisionEventHandler = {
  register: ReturnType<typeof vi.fn>;
  getDecisionsForProject: ReturnType<typeof vi.fn>;
};

describe("KanbanRetrospectiveService", () => {
  let repository: MockKanbanRetrospectiveRunRepository;
  let orchestrations: MockKanbanOrchestrationRepository;
  let evidence: MockKanbanRetrospectiveEvidenceService;
  let core: MockCoreWorkflowClientService;
  let service: KanbanRetrospectiveService;
  let cycleDecisionHandler: MockCycleDecisionEventHandler;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-16T12:00:00.000Z"));

    repository = {
      createRun: vi.fn(),
      findByIdempotencyKey: vi.fn(),
      findLatestCompletedByProject: vi.fn(),
      findLatestByProject: vi.fn(),
      list: vi.fn(),
      markCompleted: vi.fn(),
      markFailed: vi.fn(),
      markSkipped: vi.fn(),
    };
    orchestrations = {
      findByproject_id: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
    };
    evidence = {
      collectProjectEvidence: vi.fn(),
    };
    core = {
      emitDomainEvent: vi.fn().mockResolvedValue(undefined),
      emitDomainEventOrThrow: vi.fn().mockResolvedValue(undefined),
    };
    cycleDecisionHandler = {
      register: vi.fn(),
      getDecisionsForProject: vi.fn().mockReturnValue([]),
    };
    service = new KanbanRetrospectiveService(
      repository as unknown as KanbanRetrospectiveRunRepository,
      orchestrations as unknown as KanbanOrchestrationRepository,
      evidence as unknown as KanbanRetrospectiveEvidenceService,
      core as unknown as CoreWorkflowClientService,
      cycleDecisionHandler as unknown as CycleDecisionEventHandler,
    );

    repository.findByIdempotencyKey.mockResolvedValue(null);
    repository.findLatestCompletedByProject.mockResolvedValue(null);
    repository.findLatestByProject.mockResolvedValue(null);
    repository.createRun.mockResolvedValue(createRun());
    repository.markCompleted.mockResolvedValue(undefined);
    repository.markFailed.mockResolvedValue(undefined);
    repository.markSkipped.mockResolvedValue(undefined);
    evidence.collectProjectEvidence.mockResolvedValue({
      state: "ready",
      projectId: "project-1",
      deltaSnapshot: createDeltaSnapshot(),
      cycleDecisionEvents: [],
    });
  });

  it("creates a run, proposes a learning candidate, and marks the run completed for completion triggers", async () => {
    const result = await service.runForCompletion({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "cycle-key-1",
      cycle_decision: "complete",
      trigger_details: { source: "cycle_decision" },
    });

    expect(repository.createRun).toHaveBeenCalledWith({
      idempotency_key:
        "kanban-retrospective:completion_event:project-1:cycle-key-1",
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_type: "completion_event",
      trigger_revision_marker: "cycle-key-1",
      started_at: new Date("2026-05-16T12:00:00.000Z"),
      diagnostics_json: {
        trigger: {
          cycle_decision: "complete",
          details: { source: "cycle_decision" },
          manual_override: false,
        },
      },
    });
    expect(evidence.collectProjectEvidence).toHaveBeenCalledWith("project-1");
    expect(core.emitDomainEventOrThrow).toHaveBeenCalledTimes(1);
    expect(core.emitDomainEventOrThrow).toHaveBeenCalledWith({
      eventName: LEARNING_CANDIDATE_PROPOSED_EVENT,
      eventId: expect.stringMatching(
        /^kanban:learning_candidate:retrospective-run-1:[a-f0-9]{64}$/u,
      ),
      payload: expect.objectContaining({
        event_name: LEARNING_CANDIDATE_PROPOSED_EVENT,
        source_service: "kanban",
        scope_type: "kanban_project",
        scope_id: "project-1",
        lesson:
          "Kanban project project-1 completed an orchestration cycle with 2 done items, 1 blocked items, and cycle decision complete.",
        confidence: 0.6,
        tags: ["kanban", "retrospective", "orchestration-cycle"],
        provenance: {
          project_id: "project-1",
          orchestration_id: "orchestration-1",
          retrospective_run_id: "retrospective-run-1",
          cycle_decision: "complete",
          trigger: {
            type: "completion_event",
            revision_marker: "cycle-key-1",
            details: { source: "cycle_decision" },
          },
        },
      }),
    });
    expect(repository.markCompleted).toHaveBeenCalledWith(
      "retrospective-run-1",
      {
        candidate_count: 1,
        learning_candidate_ids: [],
        delta_snapshot_json: createDeltaSnapshot(),
        diagnostics_json: {
          emitted_event: LEARNING_CANDIDATE_PROPOSED_EVENT,
        },
        completed_at: new Date("2026-05-16T12:00:00.000Z"),
      },
    );
    expect(result).toEqual({
      status: "completed",
      runId: "retrospective-run-1",
      candidateCount: 1,
    });
  });

  it("reuses an existing run for duplicate idempotency keys without emitting another proposal", async () => {
    repository.findByIdempotencyKey.mockResolvedValue(
      createRun({ status: "completed" }),
    );

    const result = await service.runForCompletion({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "cycle-key-1",
      cycle_decision: "complete",
    });

    expect(repository.createRun).not.toHaveBeenCalled();
    expect(evidence.collectProjectEvidence).not.toHaveBeenCalled();
    expect(core.emitDomainEventOrThrow).not.toHaveBeenCalled();
    expect(repository.markSkipped).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "skipped",
      reason: "duplicate_trigger",
      runId: "retrospective-run-1",
    });
  });

  it("skips completion triggers when cooldown is active for the project", async () => {
    repository.findLatestCompletedByProject.mockResolvedValue(
      createRun({
        id: "recent-run",
        status: "completed",
        completed_at: new Date("2026-05-16T11:55:00.000Z"),
      }),
    );

    const result = await service.runForCompletion({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "cycle-key-2",
      cycle_decision: "complete",
    });

    expect(repository.createRun).toHaveBeenCalled();
    expect(evidence.collectProjectEvidence).not.toHaveBeenCalled();
    expect(core.emitDomainEventOrThrow).not.toHaveBeenCalled();
    expect(repository.markSkipped).toHaveBeenCalledWith("retrospective-run-1", {
      skip_reason: "cooldown_active",
      diagnostics_json: { latest_run_id: "recent-run" },
      completed_at: new Date("2026-05-16T12:00:00.000Z"),
    });
    expect(result).toEqual({
      status: "skipped",
      reason: "cooldown_active",
      runId: "retrospective-run-1",
    });
  });

  it("skips for cooldown when a recent completed run exists but the latest overall run is not completed", async () => {
    repository.findLatestByProject.mockResolvedValue(
      createRun({
        id: "newer-skipped-run",
        status: "skipped",
        completed_at: new Date("2026-05-16T11:59:00.000Z"),
      }),
    );
    repository.findLatestCompletedByProject.mockResolvedValue(
      createRun({
        id: "recent-completed-run",
        status: "completed",
        completed_at: new Date("2026-05-16T11:55:00.000Z"),
      }),
    );

    const result = await service.runForCompletion({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "cycle-key-3",
      cycle_decision: "complete",
    });

    expect(evidence.collectProjectEvidence).not.toHaveBeenCalled();
    expect(core.emitDomainEventOrThrow).not.toHaveBeenCalled();
    expect(repository.markSkipped).toHaveBeenCalledWith("retrospective-run-1", {
      skip_reason: "cooldown_active",
      diagnostics_json: { latest_run_id: "recent-completed-run" },
      completed_at: new Date("2026-05-16T12:00:00.000Z"),
    });
    expect(result).toEqual({
      status: "skipped",
      reason: "cooldown_active",
      runId: "retrospective-run-1",
    });
  });

  it("marks the run skipped when evidence is insufficient", async () => {
    evidence.collectProjectEvidence.mockResolvedValue({
      state: "insufficient_evidence",
      projectId: "project-1",
      diagnostics: {
        actionRequestCount: 0,
        decisionCount: 0,
        workItemCount: 0,
      },
    });

    const result = await service.runForCompletion({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "cycle-key-1",
      cycle_decision: "complete",
    });

    expect(core.emitDomainEventOrThrow).not.toHaveBeenCalled();
    expect(repository.markSkipped).toHaveBeenCalledWith("retrospective-run-1", {
      skip_reason: "insufficient_evidence",
      diagnostics_json: {
        actionRequestCount: 0,
        decisionCount: 0,
        workItemCount: 0,
      },
      completed_at: new Date("2026-05-16T12:00:00.000Z"),
    });
    expect(result).toEqual({
      status: "skipped",
      reason: "insufficient_evidence",
      runId: "retrospective-run-1",
    });
  });

  it("marks the run failed when candidate event publisher rejection is observable", async () => {
    core.emitDomainEvent.mockResolvedValue(undefined);
    core.emitDomainEventOrThrow.mockRejectedValue(
      new Error("core unavailable"),
    );

    const result = await service.runForCompletion({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "cycle-key-1",
      cycle_decision: "complete",
    });

    expect(repository.markCompleted).not.toHaveBeenCalled();
    expect(core.emitDomainEvent).not.toHaveBeenCalled();
    expect(core.emitDomainEventOrThrow).toHaveBeenCalledTimes(1);
    expect(repository.markFailed).toHaveBeenCalledWith("retrospective-run-1", {
      failure_reason: "candidate_event_emission_failed",
      diagnostics_json: { error: "core unavailable" },
      completed_at: new Date("2026-05-16T12:00:00.000Z"),
    });
    expect(result).toEqual({
      status: "failed",
      runId: "retrospective-run-1",
      failureReason: "candidate_event_emission_failed",
    });
  });

  it("skips manual override replay after cooldown when evidence has no delta from the latest completed run", async () => {
    const unchangedDeltaSnapshot = createDeltaSnapshot();
    repository.findLatestCompletedByProject.mockResolvedValue(
      createRun({
        id: "latest-completed-run",
        status: "completed",
        completed_at: new Date("2026-05-16T11:40:00.000Z"),
        delta_snapshot_json: unchangedDeltaSnapshot,
      }),
    );
    evidence.collectProjectEvidence.mockResolvedValue({
      state: "ready",
      projectId: "project-1",
      deltaSnapshot: unchangedDeltaSnapshot,
      cycleDecisionEvents: [],
    });

    const result = await service.runManualReplay({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "manual-revision-no-delta",
      manual_override: true,
    });

    expect(core.emitDomainEventOrThrow).not.toHaveBeenCalled();
    expect(repository.markCompleted).not.toHaveBeenCalled();
    expect(repository.markSkipped).toHaveBeenCalledWith("retrospective-run-1", {
      skip_reason: "no_delta",
      diagnostics_json: { latest_run_id: "latest-completed-run" },
      completed_at: new Date("2026-05-16T12:00:00.000Z"),
    });
    expect(result).toEqual({
      status: "skipped",
      reason: "no_delta",
      runId: "retrospective-run-1",
    });
  });

  it("returns an existing run when concurrent create hits the idempotency unique constraint", async () => {
    const existingRun = createRun({
      id: "concurrent-run",
      status: "completed",
    });
    repository.findByIdempotencyKey
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingRun);
    repository.createRun.mockRejectedValue(
      Object.assign(
        new Error("duplicate key value violates unique constraint"),
        {
          code: "23505",
          constraint: "kanban_retrospective_runs_idempotency_key_key",
        },
      ),
    );

    const result = await service.runForCompletion({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "cycle-key-1",
      cycle_decision: "complete",
    });

    expect(evidence.collectProjectEvidence).not.toHaveBeenCalled();
    expect(core.emitDomainEventOrThrow).not.toHaveBeenCalled();
    expect(repository.markSkipped).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "skipped",
      reason: "duplicate_trigger",
      runId: "concurrent-run",
    });
  });

  it("runs manual replay with override through cooldown and records the replay source", async () => {
    repository.findLatestCompletedByProject.mockResolvedValue(
      createRun({
        id: "recent-run",
        status: "completed",
        completed_at: new Date("2026-05-16T11:55:00.000Z"),
      }),
    );

    const result = await service.runManualReplay({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "manual-revision-1",
      replay_of_run_id: "recent-run",
      manual_override: true,
    });

    expect(repository.createRun).toHaveBeenCalledWith({
      idempotency_key:
        "kanban-retrospective:manual_replay:project-1:manual-revision-1",
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_type: "manual_replay",
      trigger_revision_marker: "manual-revision-1",
      replay_of_run_id: "recent-run",
      started_at: new Date("2026-05-16T12:00:00.000Z"),
      diagnostics_json: {
        trigger: {
          cycle_decision: null,
          details: {},
          manual_override: true,
        },
      },
    });
    expect(evidence.collectProjectEvidence).toHaveBeenCalledWith("project-1");
    expect(repository.markSkipped).not.toHaveBeenCalled();
    expect(repository.markCompleted).toHaveBeenCalledWith(
      "retrospective-run-1",
      {
        candidate_count: 1,
        learning_candidate_ids: [],
        delta_snapshot_json: createDeltaSnapshot(),
        diagnostics_json: {
          emitted_event: LEARNING_CANDIDATE_PROPOSED_EVENT,
        },
        completed_at: new Date("2026-05-16T12:00:00.000Z"),
      },
    );
    expect(result).toEqual({
      status: "completed",
      runId: "retrospective-run-1",
      candidateCount: 1,
    });
  });

  it("returns latest project retrospective diagnostics", async () => {
    repository.findLatestByProject.mockResolvedValue(
      createRun({
        id: "latest-run",
        idempotency_key: "kanban-retrospective:manual_replay:project-1:rev-2",
        trigger_type: "manual_replay",
        status: "failed",
        skip_reason: null,
        failure_reason: "candidate_event_emission_failed",
        candidate_count: 0,
        delta_snapshot_json: createDeltaSnapshot(),
        diagnostics_json: { error: "core unavailable" },
        started_at: new Date("2026-05-16T11:58:00.000Z"),
        completed_at: new Date("2026-05-16T11:59:00.000Z"),
      }),
    );

    await expect(service.getProjectStatus("project-1")).resolves.toEqual({
      project_id: "project-1",
      latest_run_timestamp: "2026-05-16T11:59:00.000Z",
      trigger_type: "manual_replay",
      status: "failed",
      candidate_count: 0,
      skipped_reason: null,
      failure_reason: "candidate_event_emission_failed",
      idempotency_key: "kanban-retrospective:manual_replay:project-1:rev-2",
      diagnostics: { error: "core unavailable" },
      delta_snapshot: createDeltaSnapshot(),
    });
  });

  it("returns empty project retrospective diagnostics when no run exists", async () => {
    await expect(service.getProjectStatus("project-1")).resolves.toEqual({
      project_id: "project-1",
      latest_run_timestamp: null,
      trigger_type: null,
      status: null,
      candidate_count: 0,
      skipped_reason: null,
      failure_reason: null,
      idempotency_key: null,
      diagnostics: null,
      delta_snapshot: null,
    });
  });

  // ---------------------------------------------------------------------------
  // Failure-threshold trigger
  // ---------------------------------------------------------------------------
  // The `checkFailureThreshold` and `resetConsecutiveFailureCount` methods
  // (and their `setOrchestrationMetadata` test helper) moved to
  // `kanban-retrospective-failure-threshold.service.spec.ts` so the main
  // service file can stay under the project's `max-lines` budget.

  it("lists retrospective runs as API response objects", async () => {
    repository.list.mockResolvedValue([
      createRun({
        id: "run-2",
        idempotency_key: "kanban-retrospective:manual_replay:project-1:rev-2",
        trigger_type: "manual_replay",
        trigger_revision_marker: "rev-2",
        replay_of_run_id: "run-1",
        status: "completed",
        candidate_count: 2,
        delta_snapshot_json: createDeltaSnapshot(),
        diagnostics_json: { emitted_event: LEARNING_CANDIDATE_PROPOSED_EVENT },
        started_at: new Date("2026-05-16T11:58:00.000Z"),
        completed_at: new Date("2026-05-16T11:59:00.000Z"),
        created_at: new Date("2026-05-16T11:58:00.000Z"),
        updated_at: new Date("2026-05-16T11:59:00.000Z"),
      }),
    ]);

    await expect(
      service.listRuns({
        project_id: "project-1",
        status: "completed",
        limit: 25,
      }),
    ).resolves.toEqual([
      {
        id: "run-2",
        idempotency_key: "kanban-retrospective:manual_replay:project-1:rev-2",
        project_id: "project-1",
        orchestration_id: "orchestration-1",
        trigger_type: "manual_replay",
        trigger_revision_marker: "rev-2",
        replay_of_run_id: "run-1",
        status: "completed",
        skipped_reason: null,
        failure_reason: null,
        candidate_count: 2,
        diagnostics: { emitted_event: LEARNING_CANDIDATE_PROPOSED_EVENT },
        delta_snapshot: createDeltaSnapshot(),
        started_at: "2026-05-16T11:58:00.000Z",
        completed_at: "2026-05-16T11:59:00.000Z",
        created_at: "2026-05-16T11:58:00.000Z",
        updated_at: "2026-05-16T11:59:00.000Z",
      },
    ]);
    expect(repository.list).toHaveBeenCalledWith({
      projectId: "project-1",
      status: "completed",
      limit: 25,
      offset: undefined,
    });
  });
});

function createRun(
  overrides: Partial<KanbanRetrospectiveRunEntity> = {},
): KanbanRetrospectiveRunEntity {
  return {
    id: "retrospective-run-1",
    idempotency_key:
      "kanban-retrospective:completion_event:project-1:cycle-key-1",
    project_id: "project-1",
    orchestration_id: "orchestration-1",
    trigger_type: "completion_event",
    trigger_revision_marker: "cycle-key-1",
    replay_of_run_id: null,
    status: "running",
    skip_reason: null,
    failure_reason: null,
    candidate_count: 0,
    learning_candidate_ids: [],
    delta_snapshot_json: null,
    diagnostics_json: null,
    started_at: new Date("2026-05-16T12:00:00.000Z"),
    completed_at: null,
    created_at: new Date("2026-05-16T12:00:00.000Z"),
    updated_at: new Date("2026-05-16T12:00:00.000Z"),
    ...overrides,
  };
}

function createDeltaSnapshot(): KanbanRetrospectiveDeltaSnapshot {
  return {
    project: {
      id: "project-1",
      name: "Project One",
    },
    orchestration: {
      projectId: "project-1",
      mode: "autonomous",
      status: "completed",
      linkedRunId: "workflow-run-1",
      updatedAt: "2026-05-16T11:55:00.000Z",
    },
    workItems: {
      total: 4,
      countsByStatus: {
        blocked: 1,
        done: 2,
        todo: 1,
      },
    },
    decisions: {
      total: 1,
      latestCycleDecision: {
        decision: "complete",
        reasoning: "All ready work completed",
        timestamp: "2026-05-16T11:50:00.000Z",
        idempotencyKey: "cycle-key-1",
      },
      markers: {
        hasDecisionLog: true,
        hasCycleDecision: true,
        hasCycleDecisionIdempotencyKey: true,
        hasCycleDecisionRecordedAt: true,
      },
    },
    actionRequests: {
      total: 1,
      countsByStatus: {
        executed: 1,
      },
      countsByAction: {
        complete_orchestration: 1,
      },
    },
  };
}
