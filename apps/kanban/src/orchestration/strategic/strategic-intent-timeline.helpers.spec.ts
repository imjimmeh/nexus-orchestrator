import { describe, expect, it } from "vitest";
import type { DecisionEntry } from "../orchestration-internal.types";
import {
  STRATEGIC_INTENT_DECISION_TYPE,
  appendStrategicIntent,
  latestStrategicIntent,
} from "./strategic-intent-timeline.helpers";

describe("strategic-intent timeline helpers", () => {
  const baseRequest = {
    focus_initiative_id: "i1",
    rationale: "now horizon thin",
    planned_next_steps: ["delegate ideation"],
    staleness_actions: ["delegated rediscovery"],
  };

  it("appends a strategic_intent decision entry with the canonical payload", () => {
    const log = appendStrategicIntent(
      [],
      baseRequest,
      "2026-06-13T00:00:00.000Z",
    );
    expect(log).toHaveLength(1);
    expect(log[0].type).toBe(STRATEGIC_INTENT_DECISION_TYPE);
    const intent = latestStrategicIntent(log);
    expect(intent).toEqual({
      kind: "strategic_intent",
      focus_initiative_id: "i1",
      rationale: "now horizon thin",
      planned_next_steps: ["delegate ideation"],
      staleness_actions: ["delegated rediscovery"],
      created_at: "2026-06-13T00:00:00.000Z",
    });
  });

  it("returns the most recent strategic_intent when several exist", () => {
    const existing: DecisionEntry[] = [
      { timestamp: "t0", type: "decision", reasoning: "unrelated" },
    ];
    const after1 = appendStrategicIntent(
      existing,
      { ...baseRequest, rationale: "first" },
      "2026-06-13T00:00:00.000Z",
    );
    const after2 = appendStrategicIntent(
      after1,
      { ...baseRequest, rationale: "second" },
      "2026-06-13T01:00:00.000Z",
    );
    expect(latestStrategicIntent(after2)?.rationale).toBe("second");
  });

  it("returns null when no strategic_intent entry exists", () => {
    expect(
      latestStrategicIntent([{ timestamp: "t", type: "decision" }]),
    ).toBeNull();
  });
});
