import { describe, expect, it } from "vitest";

import {
  compactOrchestrationDiagnostics,
  PROJECT_STATE_DECISION_HISTORY_LIMIT,
  PROJECT_STATE_DECISION_REASONING_CHAR_LIMIT,
} from "./project-state-diagnostics.helper";

function makeHistory(count: number, reasoningLength: number) {
  return Array.from({ length: count }, (_unused, index) => ({
    timestamp: `2026-06-27T08:0${(index % 9).toString()}:00.000Z`,
    type: "cycle",
    reasoning: "r".repeat(reasoningLength),
    idempotencyKey: `key-${index.toString()}`,
  }));
}

describe("compactOrchestrationDiagnostics", () => {
  it("returns non-record diagnostics unchanged", () => {
    expect(compactOrchestrationDiagnostics(null)).toBeNull();
    expect(compactOrchestrationDiagnostics("x")).toBe("x");
  });

  it("keeps only the most-recent decision-history entries", () => {
    const diagnostics = {
      decisionCount: 20,
      decisionHistory: makeHistory(20, 50),
    };

    const compact = compactOrchestrationDiagnostics(diagnostics) as {
      decisionCount: number;
      decisionHistory: { idempotencyKey: string }[];
    };

    expect(compact.decisionHistory).toHaveLength(
      PROJECT_STATE_DECISION_HISTORY_LIMIT,
    );
    // Most-recent entries survive (input is oldest-first).
    expect(compact.decisionHistory.at(-1)?.idempotencyKey).toBe("key-19");
    // decisionCount is preserved so the agent still knows the true total.
    expect(compact.decisionCount).toBe(20);
  });

  it("truncates oversized reasoning text on each surviving entry", () => {
    const diagnostics = {
      decisionHistory: makeHistory(
        3,
        PROJECT_STATE_DECISION_REASONING_CHAR_LIMIT + 5_000,
      ),
    };

    const compact = compactOrchestrationDiagnostics(diagnostics) as {
      decisionHistory: { reasoning: string }[];
    };

    for (const entry of compact.decisionHistory) {
      expect(entry.reasoning.length).toBeLessThanOrEqual(
        PROJECT_STATE_DECISION_REASONING_CHAR_LIMIT + 1,
      );
      expect(entry.reasoning).toContain("…");
    }
  });

  it("collapses the whole payload well under the truncation threshold", () => {
    const diagnostics = {
      decisionCount: 20,
      decisionHistory: makeHistory(20, 13_000),
    };

    const compact = compactOrchestrationDiagnostics(diagnostics);

    expect(JSON.stringify(compact).length).toBeLessThan(32_000);
  });

  it("leaves diagnostics without a decisionHistory array untouched", () => {
    const diagnostics = { decisionCount: 0, reasons: [] };
    expect(compactOrchestrationDiagnostics(diagnostics)).toEqual(diagnostics);
  });
});
