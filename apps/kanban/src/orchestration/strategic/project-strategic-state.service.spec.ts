import { describe, beforeEach, it, expect, vi, type Mock } from "vitest";
import type { KanbanOrchestrationEntity } from "../../database/entities/kanban-orchestration.entity";
import type { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity";
import { KanbanOrchestrationRepository } from "../../database/repositories/kanban-orchestration.repository";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository";
import type { Initiative } from "@nexus/kanban-contracts";
import { ProjectStrategicStateService } from "./project-strategic-state.service";

const PROJECT_ID = "00000000-0000-0000-0000-000000000001";

function buildService(
  orchestrationRecord: KanbanOrchestrationEntity | null,
  workItems: KanbanWorkItemEntity[],
): ProjectStrategicStateService {
  const orchestrations = {
    findByproject_id: vi.fn().mockResolvedValue(orchestrationRecord),
  } as unknown as KanbanOrchestrationRepository;

  const workItemRepo = {
    findByproject_id: vi.fn().mockResolvedValue(workItems),
  } as unknown as KanbanWorkItemRepository;

  return new ProjectStrategicStateService(orchestrations, workItemRepo);
}

function buildOrchestration(
  overrides: Partial<KanbanOrchestrationEntity> = {},
): KanbanOrchestrationEntity {
  return {
    project_id: PROJECT_ID,
    goals: "test goals",
    mode: "autonomous",
    status: "idle",
    linked_run_id: null,
    decision_log: null,
    action_requests: null,
    metadata: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildWorkItem(
  overrides: Partial<KanbanWorkItemEntity> = {},
): KanbanWorkItemEntity {
  return {
    id: "wi-1",
    project_id: PROJECT_ID,
    title: "Test work item",
    description: null,
    status: "backlog",
    priority: "p2",
    scope: "standard",
    assigned_agent_id: null,
    token_spend: 0,
    current_execution_id: null,
    waiting_for_input: false,
    execution_config: null,
    metadata: null,
    linked_run_id: null,
    initiative_id: null,
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function buildInitiative(overrides: Partial<Initiative> = {}): Initiative {
  return {
    id: "init-1",
    project_id: PROJECT_ID,
    title: "Test initiative",
    description: null,
    horizon: "now",
    priority: 0,
    status: "active",
    goalIds: [],
    lastReviewedAt: null,
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProjectStrategicStateService", () => {
  describe("mergesSinceDiscovery", () => {
    it("counts completed-status items updated after lastDiscoveryAt", async () => {
      const discoveryAt = "2026-05-01T00:00:00.000Z";
      const orchestration = buildOrchestration({
        metadata: { last_discovery_at: discoveryAt },
      });
      const workItems = [
        buildWorkItem({
          id: "wi-done-after",
          status: "done",
          updated_at: new Date("2026-05-10T00:00:00.000Z"),
        }),
        buildWorkItem({
          id: "wi-done-before",
          status: "done",
          updated_at: new Date("2026-04-01T00:00:00.000Z"),
        }),
        buildWorkItem({
          id: "wi-rtm-after",
          status: "ready-to-merge",
          updated_at: new Date("2026-05-15T00:00:00.000Z"),
        }),
        buildWorkItem({
          id: "wi-backlog",
          status: "backlog",
          updated_at: new Date("2026-05-20T00:00:00.000Z"),
        }),
      ];
      const service = buildService(orchestration, workItems);
      const state = await service.buildStrategicState(PROJECT_ID, []);

      expect(state.staleness.mergesSinceDiscovery).toBe(2);
    });

    it("counts all completed items when lastDiscoveryAt is null", async () => {
      const orchestration = buildOrchestration({ metadata: null });
      const workItems = [
        buildWorkItem({ id: "wi-done-1", status: "done" }),
        buildWorkItem({ id: "wi-done-2", status: "ready-to-merge" }),
        buildWorkItem({ id: "wi-backlog", status: "backlog" }),
      ];
      const service = buildService(orchestration, workItems);
      const state = await service.buildStrategicState(PROJECT_ID, []);

      expect(state.staleness.mergesSinceDiscovery).toBe(2);
    });

    it("counts awaiting-pr-merge as a completed strategic state", async () => {
      const orchestration = buildOrchestration({ metadata: null });
      const workItems = [
        buildWorkItem({ id: "wi-awaiting-pr", status: "awaiting-pr-merge" }),
        buildWorkItem({ id: "wi-backlog", status: "backlog" }),
      ];
      const service = buildService(orchestration, workItems);
      const state = await service.buildStrategicState(PROJECT_ID, []);

      expect(state.staleness.mergesSinceDiscovery).toBe(1);
    });
  });

  describe("lastInitiativeReviewAt", () => {
    it("derives lastInitiativeReviewAt from the most recently reviewed initiative", async () => {
      const orchestration = buildOrchestration();
      const initiatives = [
        buildInitiative({
          id: "init-old",
          lastReviewedAt: "2026-03-01T00:00:00.000Z",
        }),
        buildInitiative({
          id: "init-new",
          lastReviewedAt: "2026-06-01T00:00:00.000Z",
        }),
        buildInitiative({
          id: "init-null",
          lastReviewedAt: null,
        }),
      ];
      const service = buildService(orchestration, []);
      const state = await service.buildStrategicState(PROJECT_ID, initiatives);

      expect(state.staleness.lastInitiativeReviewAt).toBe(
        "2026-06-01T00:00:00.000Z",
      );
    });
  });

  describe("burn rate and starvation forecast", () => {
    it("computes recentBurnRatePerCycle and starvationForecastCycles from cycle decisions", async () => {
      const now = "2026-06-13T00:00:00.000Z";
      // 5 cycleDecision entries in the last BURN_RATE_CYCLE_WINDOW (10)
      // 3 work items completed since the window start timestamp
      const windowStart = "2026-06-10T00:00:00.000Z";
      const decisionLog = [
        {
          timestamp: "2026-06-09T00:00:00.000Z",
          type: "decision",
          cycleDecision: "repeat",
        },
        { timestamp: windowStart, type: "decision", cycleDecision: "repeat" },
        {
          timestamp: "2026-06-11T00:00:00.000Z",
          type: "decision",
          cycleDecision: "repeat",
        },
        {
          timestamp: "2026-06-12T00:00:00.000Z",
          type: "decision",
          cycleDecision: "repeat",
        },
        {
          timestamp: "2026-06-12T12:00:00.000Z",
          type: "decision",
          cycleDecision: "repeat",
        },
        { timestamp: now, type: "decision", cycleDecision: "repeat" },
      ];
      const orchestration = buildOrchestration({
        decision_log: decisionLog as unknown as Record<string, unknown>[],
      });
      const workItems = [
        buildWorkItem({
          id: "wi-done-1",
          status: "done",
          updated_at: new Date("2026-06-10T12:00:00.000Z"),
        }),
        buildWorkItem({
          id: "wi-done-2",
          status: "done",
          updated_at: new Date("2026-06-11T00:00:00.000Z"),
        }),
        buildWorkItem({
          id: "wi-done-3",
          status: "ready-to-merge",
          updated_at: new Date("2026-06-12T00:00:00.000Z"),
        }),
        // 2 backlog items
        buildWorkItem({ id: "wi-backlog-1", status: "backlog" }),
        buildWorkItem({ id: "wi-backlog-2", status: "backlog" }),
      ];
      const service = buildService(orchestration, workItems);
      const state = await service.buildStrategicState(PROJECT_ID, []);

      // 6 cycle-decision entries total; last BURN_RATE_CYCLE_WINDOW = 10 takes all 6
      // window start = timestamp of oldest in the window = "2026-06-09T00:00:00.000Z"
      // items completed since that date: wi-done-1, wi-done-2, wi-done-3 = 3
      // rate = 3 / 6 = 0.5
      expect(state.staleness.recentBurnRatePerCycle).toBeCloseTo(0.5);
      // backlogDepth = 2, rate = 0.5 => forecast = 2 / 0.5 = 4
      expect(state.staleness.starvationForecastCycles).toBeCloseTo(4);
    });

    it("sets starvationForecastCycles to null when burn rate is 0", async () => {
      const orchestration = buildOrchestration({ decision_log: null });
      const workItems = [
        buildWorkItem({ id: "wi-backlog", status: "backlog" }),
      ];
      const service = buildService(orchestration, workItems);
      const state = await service.buildStrategicState(PROJECT_ID, []);

      expect(state.staleness.recentBurnRatePerCycle).toBe(0);
      expect(state.staleness.starvationForecastCycles).toBeNull();
    });
  });

  describe("latestStrategicIntent", () => {
    it("surfaces the most recent strategic_intent from the decision log", async () => {
      const decisionLog = [
        {
          timestamp: "2026-06-01T00:00:00.000Z",
          type: "strategic_intent",
          strategicIntent: {
            kind: "strategic_intent",
            focus_initiative_id: "init-1",
            rationale: "first rationale",
            planned_next_steps: [],
            staleness_actions: [],
            created_at: "2026-06-01T00:00:00.000Z",
          },
        },
        {
          timestamp: "2026-06-10T00:00:00.000Z",
          type: "strategic_intent",
          strategicIntent: {
            kind: "strategic_intent",
            focus_initiative_id: "init-2",
            rationale: "latest rationale",
            planned_next_steps: ["step 1"],
            staleness_actions: ["action 1"],
            created_at: "2026-06-10T00:00:00.000Z",
          },
        },
      ];
      const orchestration = buildOrchestration({
        decision_log: decisionLog as unknown as Record<string, unknown>[],
      });
      const service = buildService(orchestration, []);
      const state = await service.buildStrategicState(PROJECT_ID, []);

      expect(state.latestStrategicIntent).toEqual({
        kind: "strategic_intent",
        focus_initiative_id: "init-2",
        rationale: "latest rationale",
        planned_next_steps: ["step 1"],
        staleness_actions: ["action 1"],
        created_at: "2026-06-10T00:00:00.000Z",
      });
    });
  });

  describe("empty defaults when no orchestration record", () => {
    it("returns zero-value staleness and null intent when no orchestration record exists", async () => {
      const service = buildService(null, []);
      const state = await service.buildStrategicState(PROJECT_ID, []);

      expect(state.staleness.lastDiscoveryAt).toBeNull();
      expect(state.staleness.mergesSinceDiscovery).toBe(0);
      expect(state.staleness.commitsSinceDiscovery).toBeNull();
      expect(state.staleness.lastCharterUpdateAt).toBeNull();
      expect(state.staleness.lastInitiativeReviewAt).toBeNull();
      expect(state.staleness.lastWorkItemCreatedAt).toBeNull();
      expect(state.staleness.backlogDepth).toBe(0);
      expect(state.staleness.recentBurnRatePerCycle).toBe(0);
      expect(state.staleness.starvationForecastCycles).toBeNull();
      expect(state.staleness.activeNowInitiativeCount).toBe(0);
      expect(state.latestStrategicIntent).toBeNull();
    });
  });

  describe("stalledPullRequests", () => {
    const NOW = new Date("2026-06-22T12:00:00.000Z");
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
    });
    const prMeta = (overrides: Record<string, unknown>) => ({
      lifecycle: {
        merge: {
          status: "pull_request_opened",
          strategy: "pull-request",
          prUrl: "https://github.com/acme/widgets/pull/9",
          checks: "passing",
          reviewDecision: "approved",
          openedAt: new Date(NOW.getTime() - 60_000).toISOString(),
          ...overrides,
        },
      },
    });

    it("surfaces stalled PRs in staleness, excludes healthy open PRs", async () => {
      // The stalled-PR helper defaults `nowMs` to Date.now(), so pin the wall
      // clock to NOW so the healthy "1 minute old" PR is not aged out as
      // `stale_open` purely because the test ran some wall-clock time after
      // the fixed NOW used to build prMeta above.
      vi.useFakeTimers({ now: NOW });
      try {
        const orchestration = buildOrchestration();
        const workItems = [
          buildWorkItem({
            id: "wi-red",
            status: "awaiting-pr-merge",
            metadata: prMeta({ checks: "failing" }),
          }),
          buildWorkItem({
            id: "wi-healthy",
            status: "awaiting-pr-merge",
            metadata: prMeta({}),
          }),
        ];
        const service = buildService(orchestration, workItems);
        const state = await service.buildStrategicState(PROJECT_ID, []);

        expect(state.staleness.stalledPullRequests).toHaveLength(1);
        expect(state.staleness.stalledPullRequests[0]).toMatchObject({
          id: "wi-red",
          reason: "red_checks",
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("is empty when no orchestration record exists", async () => {
      const service = buildService(null, []);
      const state = await service.buildStrategicState(PROJECT_ID, []);
      expect(state.staleness.stalledPullRequests).toEqual([]);
    });
  });

  describe("activeNowInitiativeCount", () => {
    it("counts active now-horizon initiatives", async () => {
      const service = buildService(buildOrchestration(), []);
      const state = await service.buildStrategicState(PROJECT_ID, [
        buildInitiative({ horizon: "now", status: "active" }),
        buildInitiative({ horizon: "now", status: "proposed" }),
        buildInitiative({ horizon: "next", status: "active" }),
      ]);
      expect(state.staleness.activeNowInitiativeCount).toBe(1);
    });

    it("is zero when no initiatives exist", async () => {
      const service = buildService(buildOrchestration(), []);
      const state = await service.buildStrategicState(PROJECT_ID, []);
      expect(state.staleness.activeNowInitiativeCount).toBe(0);
    });
  });
});
