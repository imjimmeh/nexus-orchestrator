import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { OrchestrationControlPlaneSchedulerService } from "../orchestration-control-plane-scheduler.service";
import { EPIC_197_SCENARIOS } from "./scenarios";
import { OrchestrationSimulationRunnerService } from "./orchestration-simulation-runner.service";
import type { OrchestrationSimulationScenario } from "./orchestration-simulation.types";

describe("OrchestrationSimulationRunnerService", () => {
  let scheduler: {
    publishFact: ReturnType<typeof vi.fn>;
    createIntent: ReturnType<typeof vi.fn>;
    evaluateIntent: ReturnType<typeof vi.fn>;
    recordLaunchAttempt: ReturnType<typeof vi.fn>;
  };
  let runner: OrchestrationSimulationRunnerService;

  beforeEach(() => {
    scheduler = {
      publishFact: vi.fn(),
      createIntent: vi.fn(),
      evaluateIntent: vi.fn(),
      recordLaunchAttempt: vi.fn(),
    };
    runner = new OrchestrationSimulationRunnerService(
      scheduler as unknown as OrchestrationControlPlaneSchedulerService,
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("runs scenario steps and computes pass state from durable records", async () => {
    scheduler.publishFact.mockResolvedValue(
      buildFactRecord({ fact_type: "event_delivery_failed" }),
    );
    scheduler.createIntent.mockResolvedValue(
      buildIntentRecord({ type: "repair_failed_run", status: "pending" }),
    );
    scheduler.evaluateIntent.mockResolvedValue({
      intentId: "intent-1",
      outcomeId: "outcome-1",
      status: "blocked",
      reason: "conflict_key_active",
      conflictKeys: [],
      activeConflicts: [],
    });
    scheduler.recordLaunchAttempt.mockResolvedValue(
      buildLaunchAttemptRecord({ workflow_id: "repair_failed_run" }),
    );
    const scenario: OrchestrationSimulationScenario = {
      id: "event-repair-launch",
      title: "Event repair records fact and launch attempt",
      projectId: "project-1",
      steps: [
        {
          name: "event failed fact",
          action: "publish_fact",
          input: buildPublishFactInput({ factType: "event_delivery_failed" }),
        },
        {
          name: "repair intent",
          action: "create_intent",
          input: buildCreateIntentInput({ type: "repair_failed_run" }),
        },
        {
          name: "evaluate repair",
          action: "evaluate_intent",
          input: { intentId: "intent-1" },
        },
        {
          name: "record launch",
          action: "record_launch_attempt",
          input: {
            intentId: "intent-1",
            workflowId: "repair_failed_run",
            idempotencyKey: "attempt-1",
            status: "accepted",
          },
        },
      ],
      expected: {
        intents: [{ type: "repair_failed_run", status: "pending" }],
        facts: [{ type: "event_delivery_failed", freshnessStatus: "fresh" }],
        noLaunchReasons: ["conflict_key_active"],
        launchedWorkflows: ["repair_failed_run"],
      },
    };

    const result = await runner.runScenario(scenario);

    expect(result).toEqual({
      scenarioId: "event-repair-launch",
      passed: true,
      diagnostics: [
        "event failed fact:published:event_delivery_failed:fresh",
        "repair intent:intent:repair_failed_run:pending",
        "evaluate repair:blocked:conflict_key_active",
        "record launch:launch:repair_failed_run:accepted",
      ],
    });
    expect(scheduler.publishFact).toHaveBeenCalledWith(
      expect.objectContaining({ factType: "event_delivery_failed" }),
    );
    expect(scheduler.createIntent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "repair_failed_run" }),
    );
  });

  it("fails expected assertions against records instead of diagnostic strings", async () => {
    scheduler.createIntent.mockResolvedValue(
      buildIntentRecord({ type: "repair_failed_run", status: "pending" }),
    );
    const scenario: OrchestrationSimulationScenario = {
      id: "missing-expected-intent",
      title: "Missing expected intent",
      projectId: "project-1",
      steps: [
        {
          name: "repair intent",
          action: "create_intent",
          input: buildCreateIntentInput({ type: "repair_failed_run" }),
        },
      ],
      expected: {
        intents: [{ type: "discover_unknowns", status: "pending" }],
      },
    };

    const result = await runner.runScenario(scenario);

    expect(result.passed).toBe(false);
    expect(result.diagnostics).toContain(
      "missing intent discover_unknowns with status pending",
    );
  });

  it("validates step inputs before invoking scheduler operations", async () => {
    await expect(
      runner.runScenario({
        id: "invalid",
        title: "Invalid",
        projectId: "project-1",
        steps: [
          {
            name: "bad fact",
            action: "publish_fact",
            input: { projectId: "project-1" },
          },
        ],
        expected: {},
      }),
    ).rejects.toThrow("Simulation step bad fact requires factType");
    expect(scheduler.publishFact).not.toHaveBeenCalled();
  });

  it("handles event projection and stale link repair action variants deterministically", async () => {
    scheduler.publishFact
      .mockResolvedValueOnce(
        buildFactRecord({ fact_type: "event_delivery_failed" }),
      )
      .mockResolvedValueOnce(
        buildFactRecord({ fact_type: "stale_link_detected" }),
      );
    scheduler.createIntent
      .mockResolvedValueOnce(
        buildIntentRecord({ type: "repair_failed_run", status: "pending" }),
      )
      .mockResolvedValueOnce(
        buildIntentRecord({ type: "reconcile_stale_links", status: "pending" }),
      );

    const result = await runner.runScenario({
      id: "projection-and-stale-link",
      title: "Projection and stale link",
      projectId: "project-1",
      steps: [
        {
          name: "failed projection",
          action: "publish_event_projection",
          input: {
            projectId: "project-1",
            eventId: "event-1",
            eventName: "kanban.test",
            error: "delivery failed",
          },
        },
        {
          name: "repair stale link",
          action: "repair_stale_link",
          input: {
            projectId: "project-1",
            workflowRunId: "run-1",
            workItemId: "item-1",
          },
        },
      ],
      expected: {
        intents: [
          { type: "repair_failed_run", status: "pending" },
          { type: "reconcile_stale_links", status: "pending" },
        ],
        facts: [
          { type: "event_delivery_failed" },
          { type: "stale_link_detected" },
        ],
      },
    });

    expect(result.passed).toBe(true);
    expect(scheduler.publishFact).toHaveBeenCalledTimes(2);
    expect(scheduler.createIntent).toHaveBeenCalledTimes(2);
  });

  it("defines the initial EPIC-197 acceptance scenario coverage", () => {
    expect(EPIC_197_SCENARIOS.map((scenario) => scenario.id)).toEqual([
      "imported-repo-bootstrap",
      "upstream-rediscovery",
      "parallel-discovery-implementation",
      "qa-rejection",
      "stale-link-recovery",
      "duplicate-wakeup",
      "merge-conflict",
      "event-delivery-failure-repair",
    ]);
  });
});

function buildPublishFactInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    factType: "project_spec_current",
    subjectKind: "project",
    subjectId: "project-1",
    sourceType: "simulation",
    sourceId: "scenario",
    confidence: 1,
    payload: {},
    ...overrides,
  };
}

function buildCreateIntentInput(overrides: Record<string, unknown> = {}) {
  return {
    projectId: "project-1",
    lane: "repair",
    type: "repair_failed_run",
    requester: "simulation",
    reason: "scenario reason",
    ...overrides,
  };
}

function buildFactRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "fact-1",
    fact_type: "project_spec_current",
    freshness_status: "fresh",
    ...overrides,
  };
}

function buildIntentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    type: "repair_failed_run",
    status: "pending",
    ...overrides,
  };
}

function buildLaunchAttemptRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "attempt-1",
    workflow_id: "repair_failed_run",
    status: "accepted",
    ...overrides,
  };
}
