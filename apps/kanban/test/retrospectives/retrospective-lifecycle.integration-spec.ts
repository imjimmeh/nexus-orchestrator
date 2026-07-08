import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CoreWorkflowClientService } from "../../src/core/core-workflow-client.service";
import type { KanbanOrchestrationEntity } from "../../src/database/entities/kanban-orchestration.entity";
import type { KanbanRetrospectiveRunEntity } from "../../src/database/entities/kanban-retrospective-run.entity";
import type { KanbanOrchestrationRepository } from "../../src/database/repositories/kanban-orchestration.repository";
import type { KanbanRetrospectiveRunRepository } from "../../src/database/repositories/kanban-retrospective-run.repository";
import {
  FAILURE_TIMESTAMPS_METADATA_KEY,
  LAST_EMITTED_AT_METADATA_KEY,
  LAST_EMITTED_WINDOW_METADATA_KEY,
} from "../../src/retrospectives/kanban-retrospective-failure-threshold.helpers";
import { KanbanRetrospectiveEvidenceService } from "../../src/retrospectives/kanban-retrospective-evidence.service";
import { KanbanRetrospectiveFailureThresholdService } from "../../src/retrospectives/kanban-retrospective-failure-threshold.service";
import { KanbanRetrospectiveService } from "../../src/retrospectives/kanban-retrospective.service";
import {
  LEARNING_CANDIDATE_PROPOSED_EVENT,
  type KanbanRetrospectiveDeltaSnapshot,
} from "../../src/retrospectives/retrospective.types";
import type { CycleDecisionEventHandler } from "../../src/retrospectives/events/cycle-decision-event.handler";

// The default beforeEach system time in this file is
// `2026-06-13T12:00:00.000Z` (= epoch seconds 1781352000). With the
// default sliding window of 600s, the deterministic window-start
// epoch seconds is Math.floor((1781352000 - 600) / 60) * 60 =
// 1781351400.
const LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS = 1781352000;
const LIFECYCLE_WINDOW_START_EPOCH_SECONDS = 1781351400;

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

type MockKanbanOrchestrationRepository = {
  findByproject_id: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
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

  it("queries the cycle decision handler for the project and includes its events as evidence in the emitted learning candidate", async () => {
    cycleDecisionHandler.getDecisionsForProject.mockReturnValue([
      {
        evidenceId: "evidence-cycle-key-1",
        projectId: "project-1",
        decisionType: "complete",
        reason: "All work completed",
        boardState: {
          totalItems: 4,
          countsByStatus: { blocked: 1, done: 2, todo: 1 },
          blockedItems: 1,
          completionRate: 50,
          goalCoverage: { totalGoals: 1, coveredGoals: 1, goalIds: ["goal-1"] },
        },
        isSubstantive: true,
        idempotencyKey: "cycle-key-1",
        provenance: {
          workflowRunId: "workflow-run-1",
          jobId: "job-1",
          decisionSource: "orchestration_cycle",
        },
        recordedAt: "2026-05-16T11:50:00.000Z",
        storedAt: "2026-05-16T11:51:00.000Z",
        windowStart: "2026-05-09T11:51:00.000Z",
        windowEnd: "2026-05-16T11:51:00.000Z",
      },
    ]);
    evidence.collectProjectEvidence.mockResolvedValue({
      state: "ready",
      projectId: "project-1",
      deltaSnapshot: createDeltaSnapshot(),
      cycleDecisionEvents: [],
    });

    const result = await service.runForCompletion({
      project_id: "project-1",
      orchestration_id: "orchestration-1",
      trigger_revision_marker: "cycle-key-1",
      cycle_decision: "complete",
    });

    expect(cycleDecisionHandler.getDecisionsForProject).toHaveBeenCalledWith(
      "project-1",
    );
    expect(core.emitDomainEventOrThrow).toHaveBeenCalledTimes(1);
    const emittedCall = core.emitDomainEventOrThrow.mock.calls[0]?.[0] as {
      payload: {
        evidence: Array<{
          kind: string;
          id: string;
          summary: string;
          data: Record<string, unknown>;
        }>;
      };
    };
    const cycleDecisionEvidence = emittedCall.payload.evidence.find(
      (entry) => entry.kind === "kanban_cycle_decision_event",
    );
    expect(cycleDecisionEvidence).toBeDefined();
    expect(cycleDecisionEvidence?.data).toMatchObject({
      decisionType: "complete",
      reason: "All work completed",
      isSubstantive: true,
      idempotencyKey: "cycle-key-1",
    });
    expect(result).toEqual({
      status: "completed",
      runId: "retrospective-run-1",
      candidateCount: 1,
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

// ---------------------------------------------------------------------------
// failure_threshold trigger acceptance suite
//
// Verifies the end-to-end contract for the failure_threshold retrospective
// trigger wired through the production `KanbanRetrospectiveService`.
//
// The unit tests in `kanban-retrospective.service.spec.ts` exercise the
// service with hand-rolled vi.fn() mocks; this suite goes one step further
// and uses in-memory repository implementations so we can verify the actual
// persisted run/ orchestration state (status, candidate_count, metadata,
// idempotency_key) after each operation, not just that the repository
// methods were invoked.
// ---------------------------------------------------------------------------

function makeFailureThresholdOrchestration(
  overrides: Partial<KanbanOrchestrationEntity> = {},
): KanbanOrchestrationEntity {
  return {
    project_id: "project-1",
    goals: "ship it",
    mode: "autonomous",
    status: "orchestrating",
    linked_run_id: "run-1",
    decision_log: null,
    action_requests: null,
    metadata: {},
    created_at: new Date("2026-06-13T00:00:00.000Z"),
    updated_at: new Date("2026-06-13T00:00:00.000Z"),
    ...overrides,
  };
}

function makeFailureThresholdRun(
  overrides: Partial<KanbanRetrospectiveRunEntity> = {},
): KanbanRetrospectiveRunEntity {
  return {
    id: "failure-threshold-run-1",
    idempotency_key: "retro:failure:project-1:3",
    project_id: "project-1",
    orchestration_id: null,
    trigger_type: "failure_threshold",
    trigger_revision_marker: "2026-06-13T12:00:00.000Z",
    replay_of_run_id: null,
    status: "running",
    skip_reason: null,
    failure_reason: null,
    candidate_count: 0,
    learning_candidate_ids: [],
    delta_snapshot_json: null,
    diagnostics_json: null,
    started_at: new Date("2026-06-13T12:00:00.000Z"),
    completed_at: null,
    created_at: new Date("2026-06-13T12:00:00.000Z"),
    updated_at: new Date("2026-06-13T12:00:00.000Z"),
    ...overrides,
  };
}

function makeFailureThresholdDeltaSnapshot(
  overrides: Partial<KanbanRetrospectiveDeltaSnapshot> = {},
): KanbanRetrospectiveDeltaSnapshot {
  return {
    project: { id: "project-1", name: "Project One" },
    orchestration: {
      projectId: "project-1",
      mode: "autonomous",
      status: "orchestrating",
      linkedRunId: null,
      updatedAt: "2026-06-13T00:00:00.000Z",
    },
    workItems: {
      total: 3,
      countsByStatus: { todo: 1, in_progress: 1, done: 1 },
    },
    decisions: {
      total: 1,
      latestCycleDecision: {
        decision: "complete",
        reasoning: "done",
        timestamp: "2026-06-13T00:00:00.000Z",
        idempotencyKey: "cycle-1",
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
      countsByStatus: { executed: 1 },
      countsByAction: { complete_orchestration: 1 },
    },
    ...overrides,
  };
}

describe("KanbanRetrospectiveService failure_threshold trigger acceptance", () => {
  let service: KanbanRetrospectiveService;
  let failureThresholdService: KanbanRetrospectiveFailureThresholdService;

  // Backing state for the in-memory repositories.
  let orchestrationState: KanbanOrchestrationEntity;
  let runStore: Map<string, KanbanRetrospectiveRunEntity>;

  // The in-memory repositories are typed as plain callable spies so the
  // vitest matcher surface (`toHaveBeenCalled`, `toHaveBeenCalledTimes`, etc.)
  // is available without `as any` casts at the assertion sites. The
  // assignments cast to the production repository types so the service can
  // consume them unchanged.
  let orchestrationsRepo: {
    findByproject_id: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    findByLinkedRunId: ReturnType<typeof vi.fn>;
    clearLinkedRunIfMatches: ReturnType<typeof vi.fn>;
    findAll: ReturnType<typeof vi.fn>;
    findByStatus: ReturnType<typeof vi.fn>;
    deleteByproject_id: ReturnType<typeof vi.fn>;
  };
  let runsRepo: {
    createRun: ReturnType<typeof vi.fn>;
    findByIdempotencyKey: ReturnType<typeof vi.fn>;
    findLatestByProject: ReturnType<typeof vi.fn>;
    findLatestCompletedByProject: ReturnType<typeof vi.fn>;
    markCompleted: ReturnType<typeof vi.fn>;
    markSkipped: ReturnType<typeof vi.fn>;
    markFailed: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
  };
  let evidenceSvc: KanbanRetrospectiveEvidenceService;
  let coreClient: CoreWorkflowClientService;
  let cycleDecisionHandler: CycleDecisionEventHandler;

  // Captured at suite entry so we can fully restore the env var on teardown
  // even when other suites in the same process set/unset it.
  const originalFailureThresholdEnv = process.env.FAILURE_THRESHOLD_COUNT;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T12:00:00.000Z"));

    // Always start each test from a clean threshold so test ordering cannot
    // leak behaviour from a previous test.
    delete process.env.FAILURE_THRESHOLD_COUNT;

    // ------------------------------------------------------------------
    // Orchestration state — backed by a single in-memory entity. Mutating
    // `metadata` here mirrors what the production repository would do under
    // a real write, so callers see the latest values on subsequent reads.
    // ------------------------------------------------------------------
    orchestrationState = makeFailureThresholdOrchestration();
    runStore = new Map<string, KanbanRetrospectiveRunEntity>();

    orchestrationsRepo = {
      findByproject_id: vi.fn((projectId: string) => {
        if (orchestrationState.project_id === projectId) {
          // Return a shallow copy so callers see current state.
          return Promise.resolve(
            Object.assign({}, orchestrationState),
          );
        }
        return Promise.resolve(null);
      }),
      save: vi.fn((input: Partial<KanbanOrchestrationEntity>) => {
        orchestrationState = Object.assign(
          {},
          orchestrationState,
          input,
        );
        return Promise.resolve(orchestrationState);
      }),
      // Unused by the failure_threshold code path, but provided for type
      // completeness.
      findByLinkedRunId: vi.fn().mockResolvedValue(null),
      clearLinkedRunIfMatches: vi.fn().mockResolvedValue(true),
      findAll: vi.fn().mockResolvedValue([]),
      findByStatus: vi.fn().mockResolvedValue([]),
      deleteByproject_id: vi.fn().mockResolvedValue(undefined),
    };

    // ------------------------------------------------------------------
    // Retrospective run repository — backed by a Map so the run lifecycle
    // (create → markCompleted) is observable through the actual stored
    // entity, not just the mock invocation.
    // ------------------------------------------------------------------
    runsRepo = {
      createRun: vi.fn((input) => {
        const entity = makeFailureThresholdRun({
          id: `failure-threshold-run-${runStore.size + 1}`,
          idempotency_key: input.idempotency_key,
          project_id: input.project_id,
          orchestration_id: input.orchestration_id ?? null,
          trigger_type: input.trigger_type,
          trigger_revision_marker: input.trigger_revision_marker ?? null,
          replay_of_run_id: input.replay_of_run_id ?? null,
          status: "running",
          skip_reason: null,
          failure_reason: null,
          candidate_count: 0,
          learning_candidate_ids: [],
          delta_snapshot_json: null,
          diagnostics_json: input.diagnostics_json ?? null,
          started_at: input.started_at ?? new Date(),
          completed_at: null,
          created_at: new Date(),
          updated_at: new Date(),
        });
        runStore.set(entity.id, entity);
        return Promise.resolve(entity);
      }),
      findByIdempotencyKey: vi.fn((key: string) => {
        for (const run of runStore.values()) {
          if (run.idempotency_key === key) {
            return Promise.resolve(run);
          }
        }
        return Promise.resolve(null);
      }),
      findLatestByProject: vi.fn((projectId: string) => {
        const matching = [...runStore.values()]
          .filter((r) => r.project_id === projectId)
          .sort(
            (a, b) => b.created_at.getTime() - a.created_at.getTime(),
          );
        return Promise.resolve(matching[0] ?? null);
      }),
      findLatestCompletedByProject: vi.fn((projectId: string) => {
        const matching = [...runStore.values()]
          .filter(
            (r) => r.project_id === projectId && r.status === "completed",
          )
          .sort((a, b) => {
            const aTs = a.completed_at?.getTime() ?? 0;
            const bTs = b.completed_at?.getTime() ?? 0;
            return bTs - aTs;
          });
        return Promise.resolve(matching[0] ?? null);
      }),
      markCompleted: vi.fn((id: string, input) => {
        const run = runStore.get(id);
        if (run) {
          run.status = "completed";
          run.candidate_count = input.candidate_count;
          run.learning_candidate_ids = input.learning_candidate_ids ?? [];
          run.delta_snapshot_json = input.delta_snapshot_json ?? null;
          run.diagnostics_json = input.diagnostics_json ?? null;
          run.completed_at = input.completed_at ?? new Date();
          run.updated_at = new Date();
        }
        return Promise.resolve();
      }),
      markSkipped: vi.fn((id: string, input) => {
        const run = runStore.get(id);
        if (run) {
          run.status = "skipped";
          run.skip_reason = input.skip_reason;
          run.diagnostics_json = input.diagnostics_json ?? null;
          run.completed_at = input.completed_at ?? new Date();
          run.updated_at = new Date();
        }
        return Promise.resolve();
      }),
      markFailed: vi.fn((id: string, input) => {
        const run = runStore.get(id);
        if (run) {
          run.status = "failed";
          run.failure_reason = input.failure_reason;
          run.diagnostics_json = input.diagnostics_json ?? null;
          run.completed_at = input.completed_at ?? new Date();
          run.updated_at = new Date();
        }
        return Promise.resolve();
      }),
      list: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
    };

    // ------------------------------------------------------------------
    // Evidence service — always returns a "ready" delta so the failure
    // threshold run flows all the way to markCompleted.
    // ------------------------------------------------------------------
    evidenceSvc = {
      collectProjectEvidence: vi.fn((projectIdArg: string) =>
        Promise.resolve({
          state: "ready" as const,
          projectId: projectIdArg,
          deltaSnapshot: makeFailureThresholdDeltaSnapshot(),
          cycleDecisionEvents: [],
        }),
      ),
    } as unknown as KanbanRetrospectiveEvidenceService;

    // ------------------------------------------------------------------
    // Core client — only emitDomainEventOrThrow is exercised by
    // executeRun in this suite.
    // ------------------------------------------------------------------
    coreClient = {
      emitDomainEvent: vi.fn().mockResolvedValue(undefined),
      emitDomainEventOrThrow: vi.fn().mockResolvedValue(undefined),
    } as unknown as CoreWorkflowClientService;

    // ------------------------------------------------------------------
    // Cycle decision handler — no decisions for these scenarios.
    // ------------------------------------------------------------------
    cycleDecisionHandler = {
      register: vi.fn(),
      getDecisionsForProject: vi.fn().mockReturnValue([]),
    } as unknown as CycleDecisionEventHandler;

    // ------------------------------------------------------------------
    // Construct the production service under test with the in-memory
    // backing stores. This is the same 5-arg signature used by the
    // production module and the unit suite.
    // ------------------------------------------------------------------
    service = new KanbanRetrospectiveService(
      runsRepo as unknown as KanbanRetrospectiveRunRepository,
      orchestrationsRepo as unknown as KanbanOrchestrationRepository,
      evidenceSvc,
      coreClient,
      cycleDecisionHandler,
    );
    // The failure-threshold service sits on top of the retrospective
    // service; it owns the consecutive-failure counter and delegates the
    // actual run execution to the retrospective service.
    failureThresholdService = new KanbanRetrospectiveFailureThresholdService(
      orchestrationsRepo as unknown as KanbanOrchestrationRepository,
      service,
    );
  });

  afterEach(() => {
    if (originalFailureThresholdEnv === undefined) {
      delete process.env.FAILURE_THRESHOLD_COUNT;
    } else {
      process.env.FAILURE_THRESHOLD_COUNT = originalFailureThresholdEnv;
    }
    vi.useRealTimers();
  });

  it("creates a retrospective run with trigger_type='failure_threshold' when consecutive failures hit the threshold", async () => {
    // The service owns the counter, so we drive failures via three
    // `checkFailureThreshold` calls. The third call lands at the default
    // threshold of 3 and must emit the retrospective.
    await failureThresholdService.checkFailureThreshold("project-1");
    await failureThresholdService.checkFailureThreshold("project-1");
    await failureThresholdService.checkFailureThreshold("project-1");

    // The persistence side-effect is observable on the in-memory
    // orchestration state.
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 3,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [
        LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
        LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
        LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
      ],
      [LAST_EMITTED_WINDOW_METADATA_KEY]: `project-1:${LIFECYCLE_WINDOW_START_EPOCH_SECONDS}`,
      [LAST_EMITTED_AT_METADATA_KEY]: LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
    });
    expect(orchestrationsRepo.save).toHaveBeenCalled();

    // A run must have been persisted via the in-memory run repository.
    expect(runStore.size).toBe(1);
    const createdRun = [...runStore.values()][0];
    expect(createdRun).toBeDefined();
    expect(createdRun.trigger_type).toBe("failure_threshold");
    expect(createdRun.idempotency_key).toBe(
      `failure-threshold:project-1:${LIFECYCLE_WINDOW_START_EPOCH_SECONDS}`,
    );
    expect(createdRun.status).toBe("completed");
    expect(createdRun.candidate_count).toBe(1);
    expect(createdRun.orchestration_id).toBeNull();
    expect(createdRun.project_id).toBe("project-1");
  });

  it("does not create a retrospective run when consecutive failures are below the threshold", async () => {
    // Two consecutive failures is below the default threshold of 3.
    await failureThresholdService.checkFailureThreshold("project-1");
    await failureThresholdService.checkFailureThreshold("project-1");

    // No run should have been created or persisted.
    expect(runsRepo.createRun).not.toHaveBeenCalled();
    expect(runStore.size).toBe(0);
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 2,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [
        LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
        LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
      ],
    });
  });

  it("uses the FAILURE_THRESHOLD_COUNT env var when set to a custom value", async () => {
    // Lower the threshold to 2 for this test. Re-construct the
    // failure-threshold service so resolveSettings() re-reads the env
    // on the first call.
    process.env.FAILURE_THRESHOLD_COUNT = "2";
    failureThresholdService = new KanbanRetrospectiveFailureThresholdService(
      orchestrationsRepo as unknown as KanbanOrchestrationRepository,
      service,
    );

    await failureThresholdService.checkFailureThreshold("project-1");
    await failureThresholdService.checkFailureThreshold("project-1");

    // Run must have been created at the custom threshold of 2.
    expect(runStore.size).toBe(1);
    const createdRun = [...runStore.values()][0];
    expect(createdRun.trigger_type).toBe("failure_threshold");
    expect(createdRun.idempotency_key).toBe(
      `failure-threshold:project-1:${LIFECYCLE_WINDOW_START_EPOCH_SECONDS}`,
    );
    expect(createdRun.status).toBe("completed");
    expect(createdRun.candidate_count).toBe(1);
  });

  it("persists consecutive_failure_count to orchestration metadata", async () => {
    expect(orchestrationState.metadata).toEqual({});

    await failureThresholdService.checkFailureThreshold("project-1");
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 1,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS],
    });

    await failureThresholdService.checkFailureThreshold("project-1");
    expect(orchestrationState.metadata).toEqual({
      consecutive_failure_count: 2,
      [FAILURE_TIMESTAMPS_METADATA_KEY]: [
        LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
        LIFECYCLE_SYSTEM_TIME_EPOCH_SECONDS,
      ],
    });

    // The orchestration repository's save() must be called for each
    // recorded failure so the counter is durable.
    expect(orchestrationsRepo.save).toHaveBeenCalledTimes(2);
  });

  it("is a no-op when no orchestration exists", async () => {
    // No orchestration exists for this project, so findByproject_id
    // returns null. The check must resolve cleanly and not write to the
    // orchestrations repository.
    await expect(
      failureThresholdService.checkFailureThreshold("project-missing"),
    ).resolves.toBeUndefined();

    // The orchestration repository must not have been written to.
    expect(orchestrationsRepo.save).not.toHaveBeenCalled();
    expect(runsRepo.createRun).not.toHaveBeenCalled();
  });
});
