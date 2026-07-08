import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { KanbanOrchestrationFactEntity } from "../../database/entities/kanban-orchestration-fact.entity";
import { KanbanOrchestrationIntentEntity } from "../../database/entities/kanban-orchestration-intent.entity";
import { KanbanOrchestrationLaunchAttemptEntity } from "../../database/entities/kanban-orchestration-launch-attempt.entity";
import { KanbanOrchestrationSchedulerOutcomeEntity } from "../../database/entities/kanban-orchestration-scheduler-outcome.entity";
import { KanbanOrchestrationFactRepository } from "../../database/repositories/kanban-orchestration-fact.repository";
import { KanbanOrchestrationIntentRepository } from "../../database/repositories/kanban-orchestration-intent.repository";
import { KanbanOrchestrationLaunchAttemptRepository } from "../../database/repositories/kanban-orchestration-launch-attempt.repository";
import { KanbanOrchestrationSchedulerOutcomeRepository } from "../../database/repositories/kanban-orchestration-scheduler-outcome.repository";
import { OrchestrationControlPlaneSchedulerService } from "./orchestration-control-plane-scheduler.service";

describe("OrchestrationControlPlaneSchedulerService", () => {
  let intentRepository: {
    createIntent: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    listActiveByLane: ReturnType<typeof vi.fn>;
    updateStatus: ReturnType<typeof vi.fn>;
  };
  let factRepository: {
    publishFact: ReturnType<typeof vi.fn>;
    listFreshByTypes: ReturnType<typeof vi.fn>;
    listFreshByTypesAndSubjects: ReturnType<typeof vi.fn>;
  };
  let outcomeRepository: {
    recordOutcome: ReturnType<typeof vi.fn>;
    listByIntent: ReturnType<typeof vi.fn>;
  };
  let launchAttemptRepository: {
    recordAttempt: ReturnType<typeof vi.fn>;
  };
  let service: OrchestrationControlPlaneSchedulerService;

  const now = new Date("2026-05-18T20:00:00.000Z");

  beforeEach(() => {
    intentRepository = {
      createIntent: vi.fn(),
      findById: vi.fn(),
      listActiveByLane: vi.fn(),
      updateStatus: vi.fn(),
    };
    factRepository = {
      publishFact: vi.fn(),
      listFreshByTypes: vi.fn(),
      listFreshByTypesAndSubjects: vi.fn(),
    };
    outcomeRepository = {
      recordOutcome: vi.fn(),
      listByIntent: vi.fn(),
    };
    launchAttemptRepository = {
      recordAttempt: vi.fn(),
    };
    service = new OrchestrationControlPlaneSchedulerService(
      intentRepository as unknown as KanbanOrchestrationIntentRepository,
      factRepository as unknown as KanbanOrchestrationFactRepository,
      outcomeRepository as unknown as KanbanOrchestrationSchedulerOutcomeRepository,
      launchAttemptRepository as unknown as KanbanOrchestrationLaunchAttemptRepository,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("records a deferred outcome and keeps the intent pending when lane capacity is reached", async () => {
    const intent = buildIntent();
    intentRepository.findById.mockResolvedValue(intent);
    intentRepository.listActiveByLane.mockResolvedValue([
      intent,
      buildIntent({ id: "other-active-intent" }),
    ]);
    outcomeRepository.recordOutcome.mockResolvedValue(
      buildOutcome({ id: "outcome-deferred", status: "deferred" }),
    );

    const decision = await service.evaluateIntent(intent.id, {
      maxActivePerLane: 1,
      now,
    });

    expect(decision.status).toBe("deferred");
    expect(decision.reason).toBe("lane_capacity_reached");
    expect(intentRepository.updateStatus).toHaveBeenCalledWith(
      intent.id,
      "pending",
    );
  });

  it("records a deferred outcome with missing fact metadata", async () => {
    const intent = buildIntent();
    intentRepository.findById.mockResolvedValue(intent);
    intentRepository.listActiveByLane.mockResolvedValue([]);
    factRepository.listFreshByTypesAndSubjects.mockResolvedValue([
      buildFact({ fact_type: "project_spec_current" }),
    ]);
    outcomeRepository.recordOutcome.mockResolvedValue(
      buildOutcome({ id: "outcome-missing-fact", status: "deferred" }),
    );

    const decision = await service.evaluateIntent(intent.id, {
      requireFreshFactTypes: ["project_spec_current", "dispatch_capacity"],
      now,
    });

    expect(decision.status).toBe("deferred");
    expect(decision.reason).toBe("missing_fresh_fact");
    expect(outcomeRepository.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          missingFreshFactTypes: ["dispatch_capacity"],
        }),
      }),
    );
    expect(intentRepository.updateStatus).toHaveBeenCalledWith(
      intent.id,
      "pending",
    );
  });

  it("records a launchable outcome when capacity and freshness checks pass", async () => {
    const intent = buildIntent();
    intentRepository.findById.mockResolvedValue(intent);
    intentRepository.listActiveByLane.mockResolvedValue([]);
    factRepository.listFreshByTypesAndSubjects.mockResolvedValue([
      buildFact({ fact_type: "project_spec_current" }),
    ]);
    outcomeRepository.recordOutcome.mockResolvedValue(
      buildOutcome({ id: "outcome-launchable", status: "launchable" }),
    );

    const decision = await service.evaluateIntent(intent.id, {
      maxActivePerLane: 2,
      requireFreshFactTypes: ["project_spec_current"],
      now,
    });

    expect(decision).toMatchObject({
      intentId: intent.id,
      outcomeId: "outcome-launchable",
      status: "launchable",
      reason: "no_conflicts",
    });
    expect(intentRepository.updateStatus).toHaveBeenCalledWith(
      intent.id,
      "launchable",
    );
  });

  it("records launch attempts with the project ID derived from the intent", async () => {
    const intent = buildIntent({ project_id: "project-derived" });
    const launchAttempt = buildLaunchAttempt({ project_id: intent.project_id });
    intentRepository.findById.mockResolvedValue(intent);
    launchAttemptRepository.recordAttempt.mockResolvedValue(launchAttempt);

    const result = await service.recordLaunchAttempt({
      intentId: intent.id,
      outcomeId: "outcome-1",
      workflowId: "workflow-dispatch",
      workflowScope: "scope-1",
      workflowRunId: "run-1",
      idempotencyKey: "attempt-key",
      status: "accepted",
    });

    expect(result).toBe(launchAttempt);
    expect(launchAttemptRepository.recordAttempt).toHaveBeenCalledWith({
      intentId: intent.id,
      outcomeId: "outcome-1",
      projectId: "project-derived",
      workflowId: "workflow-dispatch",
      workflowScope: "scope-1",
      workflowRunId: "run-1",
      idempotencyKey: "attempt-key",
      status: "accepted",
    });
  });

  it("completes a launchable intent after its wakeup is consumed", async () => {
    const intent = buildIntent({ status: "launchable" });
    intentRepository.findById.mockResolvedValue(intent);
    outcomeRepository.recordOutcome.mockResolvedValue(
      buildOutcome({
        id: "outcome-completed",
        status: "completed",
        reason: "workflow_launched",
      }),
    );

    const decision = await service.completeIntent(
      intent.id,
      "workflow_launched",
    );

    expect(decision).toMatchObject({
      intentId: intent.id,
      outcomeId: "outcome-completed",
      status: "completed",
      reason: "workflow_launched",
    });
    expect(intentRepository.updateStatus).toHaveBeenCalledWith(
      intent.id,
      "completed",
    );
  });
});

function buildIntent(
  overrides: Partial<KanbanOrchestrationIntentEntity> = {},
): KanbanOrchestrationIntentEntity {
  return {
    id: "intent-1",
    project_id: "project-1",
    lane: "dispatch",
    type: "dispatch_candidates",
    status: "pending",
    requester: "test",
    reason: "test reason",
    priority: 0,
    evidence: [],
    resource_refs: [],
    conflict_keys: [],
    workflow_id: "workflow-dispatch",
    workflow_scope: "scope-1",
    idempotency_key: "intent-key",
    supersedes_intent_id: null,
    freshness_requirements: {},
    terminal_outcome: null,
    metadata: null,
    created_at: nowDate(),
    updated_at: nowDate(),
    ...overrides,
  };
}

function buildFact(
  overrides: Partial<KanbanOrchestrationFactEntity> = {},
): KanbanOrchestrationFactEntity {
  return {
    id: "fact-1",
    project_id: "project-1",
    fact_type: "project_spec_current",
    subject_kind: "project",
    subject_id: "project-1",
    source_type: "test",
    source_id: "test-source",
    confidence: 1,
    freshness_status: "fresh",
    observed_at: nowDate(),
    expires_at: null,
    invalidated_at: null,
    invalidated_by_event_id: null,
    payload_json: {},
    evidence: [],
    metadata: null,
    created_at: nowDate(),
    updated_at: nowDate(),
    ...overrides,
  };
}

function buildOutcome(
  overrides: Partial<KanbanOrchestrationSchedulerOutcomeEntity> = {},
): KanbanOrchestrationSchedulerOutcomeEntity {
  return {
    id: "outcome-1",
    intent_id: "intent-1",
    project_id: "project-1",
    status: "launchable",
    reason: "no_conflicts",
    conflict_keys: [],
    active_conflicts: [],
    evaluated_at: nowDate(),
    policy_snapshot: {},
    metadata: null,
    created_at: nowDate(),
    ...overrides,
  };
}

function buildLaunchAttempt(
  overrides: Partial<KanbanOrchestrationLaunchAttemptEntity> = {},
): KanbanOrchestrationLaunchAttemptEntity {
  return {
    id: "attempt-1",
    intent_id: "intent-1",
    outcome_id: "outcome-1",
    project_id: "project-1",
    workflow_id: "workflow-dispatch",
    workflow_scope: "scope-1",
    workflow_run_id: "run-1",
    idempotency_key: "attempt-key",
    status: "accepted",
    failure_reason: null,
    requested_at: nowDate(),
    completed_at: null,
    response_payload: null,
    metadata: null,
    created_at: nowDate(),
    updated_at: nowDate(),
    ...overrides,
  };
}

function nowDate(): Date {
  return new Date("2026-05-18T20:00:00.000Z");
}
