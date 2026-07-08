import { describe, expect, it, vi } from "vitest";
import { OrchestrationObservabilityService } from "./orchestration-observability.service";
import { DEFAULT_DECISION_HISTORY_LIMIT } from "./decision-window.helper";
import type {
  DecisionEntry,
  OrchestrationPersistenceRecord,
} from "./orchestration-internal.types";

describe("OrchestrationObservabilityService.getAutoWakeSuppressionState", () => {
  const buildService = () =>
    new OrchestrationObservabilityService({
      findByproject_id: vi.fn().mockResolvedValue([]),
    } as never);

  const buildState = (
    overrides: Partial<OrchestrationPersistenceRecord>,
  ): OrchestrationPersistenceRecord => ({
    project_id: "p1",
    goals: "",
    mode: "autonomous",
    status: "orchestrating",
    linked_run_id: null,
    decision_log: [],
    action_requests: [],
    metadata: {},
    created_at: new Date(0),
    updated_at: new Date(0),
    ...overrides,
  });

  it("suppresses when status is completed even though the last decision is repeat", () => {
    // Reproduces run 7a8be0c5: status completed + cycle_decision repeat.
    const state = buildState({
      status: "completed",
      metadata: { cycle_decision: "repeat" },
    });

    expect(buildService().getAutoWakeSuppressionState(state)).toEqual({
      suppressed: true,
    });
  });

  it("suppresses when status is paused", () => {
    const state = buildState({ status: "paused" });

    expect(buildService().getAutoWakeSuppressionState(state)).toEqual({
      suppressed: true,
    });
  });

  it("does not suppress the normal autonomous loop (orchestrating + repeat)", () => {
    const state = buildState({
      status: "orchestrating",
      metadata: { cycle_decision: "repeat" },
    });

    expect(buildService().getAutoWakeSuppressionState(state)).toEqual({
      suppressed: false,
    });
  });

  it("still surfaces an explicit stop decision while orchestrating", () => {
    const state = buildState({
      status: "orchestrating",
      metadata: { cycle_decision: "pause" },
    });

    expect(buildService().getAutoWakeSuppressionState(state)).toEqual({
      suppressed: true,
      decision: "pause",
    });
  });

  it("returns not-suppressed for a null state", () => {
    expect(buildService().getAutoWakeSuppressionState(null)).toEqual({
      suppressed: false,
    });
  });
});

describe("OrchestrationObservabilityService.getDiagnostics decision window", () => {
  const buildService = () =>
    new OrchestrationObservabilityService({
      findByproject_id: vi.fn().mockResolvedValue([]),
    } as never);

  const buildDecisionEntry = (index: number): DecisionEntry => ({
    timestamp: new Date(index * 1000).toISOString(),
    type: "cycle_decision",
    reasoning: `decision-${index.toString()}`,
    actions: ["repeat"],
  });

  const buildDiagnosticsArgs = (
    decisionLog: DecisionEntry[],
    window?: { limit?: number; offset?: number },
  ) => ({
    projectId: "p1",
    requirePersistenceState: vi.fn().mockResolvedValue({
      project_id: "p1",
      goals: "",
      mode: "autonomous",
      status: "orchestrating",
      linked_run_id: null,
      decision_log: decisionLog,
      action_requests: [],
      metadata: {},
      created_at: new Date(0),
      updated_at: new Date(0),
    } satisfies OrchestrationPersistenceRecord),
    getDecisionLog: () => decisionLog,
    getActionRequests: () => [],
    getProjectDispatchMaxActive: () => Promise.resolve(5),
    ...window,
  });

  const fullLength = DEFAULT_DECISION_HISTORY_LIMIT + 7;

  it("default-caps decisionHistory while keeping decisionCount honest", async () => {
    const decisionLog = Array.from({ length: fullLength }, (_, i) =>
      buildDecisionEntry(i),
    );

    const diagnostics = await buildService().getDiagnostics(
      buildDiagnosticsArgs(decisionLog),
    );

    expect(diagnostics.decisionCount).toBe(fullLength);
    expect(diagnostics.decisionHistory).toHaveLength(
      DEFAULT_DECISION_HISTORY_LIMIT,
    );
    // Returns the most-recent window in chronological order.
    expect(diagnostics.decisionHistory.at(-1)?.reasoning).toBe(
      `decision-${(fullLength - 1).toString()}`,
    );
    expect(diagnostics.decisionHistory[0]?.reasoning).toBe(
      `decision-${(fullLength - DEFAULT_DECISION_HISTORY_LIMIT).toString()}`,
    );
    expect(diagnostics.lastDecision).toEqual(decisionLog.at(-1));
  });

  it("pages with an explicit limit and offset", async () => {
    const decisionLog = Array.from({ length: fullLength }, (_, i) =>
      buildDecisionEntry(i),
    );

    const diagnostics = await buildService().getDiagnostics(
      buildDiagnosticsArgs(decisionLog, { limit: 5, offset: 5 }),
    );

    expect(diagnostics.decisionCount).toBe(fullLength);
    expect(diagnostics.decisionHistory).toHaveLength(5);
    expect(diagnostics.decisionHistory.at(-1)?.reasoning).toBe(
      `decision-${(fullLength - 1 - 5).toString()}`,
    );
  });
});
