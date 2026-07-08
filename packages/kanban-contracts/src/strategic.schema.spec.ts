import { describe, expect, it } from "vitest";
import {
  IDEATION_STARVATION_THRESHOLD_CYCLES,
  REDISCOVERY_MERGE_THRESHOLD,
  RecordStrategicIntentRequestSchema,
  StrategicIntentSchema,
  StrategicStalenessSchema,
} from "./strategic.schema";

describe("strategic contracts", () => {
  it("exposes conservative threshold constants", () => {
    expect(REDISCOVERY_MERGE_THRESHOLD).toBe(10);
    expect(IDEATION_STARVATION_THRESHOLD_CYCLES).toBe(2);
  });

  it("accepts a fully-populated staleness object", () => {
    const parsed = StrategicStalenessSchema.parse({
      lastDiscoveryAt: "2026-06-01T00:00:00.000Z",
      mergesSinceDiscovery: 14,
      commitsSinceDiscovery: null,
      lastCharterUpdateAt: null,
      lastInitiativeReviewAt: "2026-06-10T00:00:00.000Z",
      lastWorkItemCreatedAt: "2026-06-12T00:00:00.000Z",
      backlogDepth: 6,
      recentBurnRatePerCycle: 2.3,
      starvationForecastCycles: 2.6,
      activeNowInitiativeCount: 2,
    });
    expect(parsed.mergesSinceDiscovery).toBe(14);
    expect(parsed.commitsSinceDiscovery).toBeNull();
  });

  it("validates a strategic_intent payload with the canonical kind", () => {
    const intent = StrategicIntentSchema.parse({
      kind: "strategic_intent",
      focus_initiative_id: "i1",
      rationale: "now horizon is thin",
      planned_next_steps: ["delegate ideation"],
      staleness_actions: ["delegated rediscovery: 14 merges since scan"],
      created_at: "2026-06-13T00:00:00.000Z",
    });
    expect(intent.kind).toBe("strategic_intent");
  });

  it("rejects a record-intent request missing rationale", () => {
    const result = RecordStrategicIntentRequestSchema.safeParse({
      focus_initiative_id: "i1",
      planned_next_steps: [],
      staleness_actions: [],
    });
    expect(result.success).toBe(false);
  });
});

const base = {
  lastDiscoveryAt: null,
  mergesSinceDiscovery: 0,
  commitsSinceDiscovery: null,
  lastCharterUpdateAt: null,
  lastInitiativeReviewAt: null,
  lastWorkItemCreatedAt: null,
  backlogDepth: 0,
  recentBurnRatePerCycle: 0,
  starvationForecastCycles: null,
};

describe("StrategicStalenessSchema activeNowInitiativeCount", () => {
  it("requires activeNowInitiativeCount", () => {
    expect(() => StrategicStalenessSchema.parse(base)).toThrow();
  });

  it("accepts the full object", () => {
    const parsed = StrategicStalenessSchema.parse({
      ...base,
      activeNowInitiativeCount: 1,
    });
    expect(parsed.activeNowInitiativeCount).toBe(1);
  });
});
