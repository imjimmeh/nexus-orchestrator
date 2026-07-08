import type { OrchestrationLane } from "./control-plane.types";

/** Default lane capacity for lanes without an explicit limit. */
export const DEFAULT_LANE_CAPACITY = 2;

/**
 * Concurrency cap per orchestration lane. `strategy` stays at 1 to serialize
 * the project CEO cycle. `work_item_transition` carries mechanical single-item
 * status flips, which are already serialized per item by the unique work_item
 * conflict-key index, so it allows real concurrency and never contends with the
 * strategy/cycle lease.
 */
export const LANE_CAPACITY: Record<OrchestrationLane, number> = {
  discovery: DEFAULT_LANE_CAPACITY,
  specification: DEFAULT_LANE_CAPACITY,
  work_item_generation: DEFAULT_LANE_CAPACITY,
  dispatch: 4,
  implementation: 4,
  review: DEFAULT_LANE_CAPACITY,
  merge: DEFAULT_LANE_CAPACITY,
  repair: DEFAULT_LANE_CAPACITY,
  upstream_analysis: DEFAULT_LANE_CAPACITY,
  strategy: 1,
  work_item_transition: 4,
  project_health: DEFAULT_LANE_CAPACITY,
};
