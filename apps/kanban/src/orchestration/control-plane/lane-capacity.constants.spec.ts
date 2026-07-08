import { describe, expect, it } from "vitest";
import {
  LANE_CAPACITY,
  DEFAULT_LANE_CAPACITY,
} from "./lane-capacity.constants";
import { ORCHESTRATION_LANES } from "./control-plane.types";

describe("LANE_CAPACITY", () => {
  it("keeps the strategy lane serialized at one slot", () => {
    expect(LANE_CAPACITY.strategy).toBe(1);
  });

  it("gives work-item transitions real concurrency separate from strategy", () => {
    expect(LANE_CAPACITY.work_item_transition).toBeGreaterThan(1);
  });

  it("falls back to the default for unmapped lanes", () => {
    expect(DEFAULT_LANE_CAPACITY).toBe(2);
  });

  it("preserves the dispatch and implementation lane capacities", () => {
    expect(LANE_CAPACITY.dispatch).toBe(4);
    expect(LANE_CAPACITY.implementation).toBe(4);
  });

  it("defines a positive capacity for every lane in the single source of truth", () => {
    expect([...Object.keys(LANE_CAPACITY)].sort()).toEqual(
      [...ORCHESTRATION_LANES].sort(),
    );
    for (const lane of ORCHESTRATION_LANES) {
      expect(LANE_CAPACITY[lane]).toBeGreaterThan(0);
    }
  });
});
