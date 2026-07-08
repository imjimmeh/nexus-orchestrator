import { describe, expect, it } from "vitest";
import {
  ORCHESTRATION_POLICY_REGISTRY,
  autonomyValuesForMode,
  modeFromAutonomyValues,
  validatePolicyEntry,
  findPolicyDescriptor,
} from "@nexus/kanban-contracts";

describe("orchestration policy registry", () => {
  it("contains the ten curated keys with spec defaults", () => {
    const byKey = Object.fromEntries(
      ORCHESTRATION_POLICY_REGISTRY.map((d) => [d.key, d]),
    );
    expect(byKey["autonomy.dispatch"].defaultValue).toBe("auto");
    expect(byKey["autonomy.merge"].defaultValue).toBe("ask");
    expect(byKey["gates.rediscovery_merge_threshold"].defaultValue).toBe(10);
    expect(byKey["gates.ideation_starvation_cycles"].defaultValue).toBe(2);
    expect(byKey["promotion.max_items_per_cycle"].defaultValue).toBe(-1);
    expect(byKey["backlog.ideation_enabled"].defaultValue).toBe(true);
    expect(byKey["backlog.target_todo_depth"].defaultValue).toBe(3);
    expect(Object.keys(byKey)).toHaveLength(10);
  });

  it("maps mode to per-phase autonomy values", () => {
    expect(autonomyValuesForMode("autonomous")).toEqual({
      "autonomy.dispatch": "auto",
      "autonomy.backlog_promotion": "auto",
      "autonomy.merge": "auto",
    });
    expect(autonomyValuesForMode("supervised")).toEqual({
      "autonomy.dispatch": "ask",
      "autonomy.backlog_promotion": "ask",
      "autonomy.merge": "ask",
    });
    expect(autonomyValuesForMode("notifications_only")).toEqual({
      "autonomy.dispatch": "off",
      "autonomy.backlog_promotion": "off",
      "autonomy.merge": "ask",
    });
  });

  it("derives a display mode from autonomy.dispatch (lossy)", () => {
    expect(modeFromAutonomyValues({ "autonomy.dispatch": "auto" })).toBe(
      "autonomous",
    );
    expect(modeFromAutonomyValues({ "autonomy.dispatch": "ask" })).toBe(
      "supervised",
    );
    expect(modeFromAutonomyValues({ "autonomy.dispatch": "off" })).toBe(
      "notifications_only",
    );
    expect(modeFromAutonomyValues({})).toBe("autonomous"); // default
  });

  it("validates curated entries against the registry", () => {
    expect(validatePolicyEntry("autonomy.dispatch", "auto")).toEqual({
      ok: true,
    });
    expect(validatePolicyEntry("autonomy.dispatch", "sometimes").ok).toBe(
      false,
    );
    expect(validatePolicyEntry("autonomy.merge", "off").ok).toBe(false); // merge has no 'off'
    expect(validatePolicyEntry("gates.rediscovery_merge_threshold", 5)).toEqual(
      {
        ok: true,
      },
    );
    expect(
      validatePolicyEntry("gates.rediscovery_merge_threshold", "five").ok,
    ).toBe(false);
    expect(validatePolicyEntry("backlog.ideation_enabled", true)).toEqual({
      ok: true,
    });
    expect(validatePolicyEntry("unknown.key", 1).ok).toBe(false);
  });

  it("exposes descriptors by key", () => {
    expect(findPolicyDescriptor("autonomy.dispatch")?.group).toBe("autonomy");
    expect(findPolicyDescriptor("nope")).toBeUndefined();
  });
});
