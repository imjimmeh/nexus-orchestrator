/**
 * Per-arm run tally consumed by the pure A/B holdout-lift computation
 * (EPIC-212 Phase 3, Task 6).
 */
export interface ArmTally {
  runs: number;
  successes: number;
}
