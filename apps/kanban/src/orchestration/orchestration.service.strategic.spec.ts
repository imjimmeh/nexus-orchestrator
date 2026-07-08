import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseRequestContextService } from "@nexus/core";
import { OrchestrationService } from "./orchestration.service";

describe("OrchestrationService — strategic intent mutations", () => {
  const byProject = new Map<
    string,
    {
      project_id: string;
      goals: string;
      mode: string;
      status: string;
      linked_run_id: string | null;
      decision_log?: unknown[] | null;
      action_requests?: unknown[] | null;
      metadata?: Record<string, unknown> | null;
      created_at: Date;
      updated_at: Date;
    }
  >();

  const orchestrationRepository = {
    save: vi.fn(
      (input: {
        project_id: string;
        goals: string;
        mode: string;
        status: string;
        linked_run_id: string | null;
        decision_log?: unknown[] | null;
        action_requests?: unknown[] | null;
        metadata?: Record<string, unknown> | null;
      }) => {
        const existing = byProject.get(input.project_id);
        const next = {
          ...input,
          updated_at: new Date(),
          created_at: existing?.created_at ?? new Date(),
        };
        byProject.set(input.project_id, next);
        return Promise.resolve(next);
      },
    ),
    findByproject_id: vi.fn((project_id: string) =>
      Promise.resolve(byProject.get(project_id) ?? null),
    ),
    findByLinkedRunId: vi.fn(() => Promise.resolve(null)),
    findByStatus: vi.fn(() => Promise.resolve([])),
    clearLinkedRunIfMatches: vi.fn(() => Promise.resolve(false)),
    findAll: vi.fn(() => Promise.resolve([])),
  };

  const requestContext = {
    getRequestId: () => "req-strategic-test",
    getCausationId: () => "cause-strategic-test",
  } as unknown as BaseRequestContextService;

  function buildService(): OrchestrationService {
    const stateLifecycleService = {
      getRecordMetadata: (value: unknown) =>
        value && typeof value === "object"
          ? (value as Record<string, unknown>)
          : {},
    };
    return new OrchestrationService(
      { requestWorkflowRun: vi.fn() },
      {} as never,
      requestContext,
      orchestrationRepository as never,
      {} as never,
      {
        findByproject_id: vi.fn(() => Promise.resolve([])),
        findDependenciesByWorkItemIds: vi.fn(() => Promise.resolve([])),
      } as never,
      { selectPolicy: vi.fn() } as never,
      { runForCompletion: vi.fn() } as never,
      { checkFailureThreshold: vi.fn(), resetConsecutiveFailureCount: vi.fn() },
      { getNumber: vi.fn() } as never,
      { hasActiveCycleLease: vi.fn() } as never,
      {} as never,
      {} as never,
      { recordCycleDecision: vi.fn(), clearCycleDecision: vi.fn() } as never,
      { requestAction: vi.fn(), approveActionRequest: vi.fn(), rejectActionRequest: vi.fn(), listProjectActionRequests: vi.fn(), listActionRequests: vi.fn() } as never,
      { getDiagnostics: vi.fn(), getActivitySummary: vi.fn(), isAutoWakeEnabled: vi.fn(), getAutoWakeSuppressionState: vi.fn(), getWakeupCooldownState: vi.fn(), recordWakeup: vi.fn() } as never,
      stateLifecycleService as never,
      { buildRunRequest: vi.fn(), buildImportedHydrationRecoveryRunRequest: vi.fn() },
      vi.fn() as never,
    );
  }

  beforeEach(() => {
    byProject.clear();
    vi.clearAllMocks();

    byProject.set("project-1", {
      project_id: "project-1",
      goals: "Ship EPIC-208",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      decision_log: [],
      action_requests: [],
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    });
  });

  it("appends a strategic_intent entry to the decision_log", async () => {
    const service = buildService();

    const result = await service.recordStrategicIntent("project-1", {
      focus_initiative_id: "init-42",
      rationale: "now horizon is thin",
      planned_next_steps: ["delegate ideation"],
      staleness_actions: ["delegated rediscovery"],
    });

    expect(result).toMatchObject({
      kind: "strategic_intent",
      focus_initiative_id: "init-42",
      rationale: "now horizon is thin",
      planned_next_steps: ["delegate ideation"],
      staleness_actions: ["delegated rediscovery"],
    });
    expect(typeof result.created_at).toBe("string");

    const persisted = byProject.get("project-1");
    const log = persisted?.decision_log as Array<Record<string, unknown>>;
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({
      type: "strategic_intent",
      strategicIntent: expect.objectContaining({
        kind: "strategic_intent",
        focus_initiative_id: "init-42",
      }),
    });
  });

  it("stamps last_discovery_at into metadata via recordDiscoveryCompleted", async () => {
    const service = buildService();
    const completedAt = "2026-06-13T12:00:00.000Z";

    await service.recordDiscoveryCompleted("project-1", completedAt);

    const persisted = byProject.get("project-1");
    expect(persisted?.metadata?.last_discovery_at).toBe(completedAt);
  });
});
