/**
 * Public contract for the pure provisional-memory probation decision
 * (EPIC-212 Phase-3 Task 7).
 *
 * `decideProbation` is I/O-free and deterministic: every input — including
 * `nowMs` and `probationUntilMs` — is injected so the full verdict matrix is
 * unit-testable to the millisecond. The `MemoryProbationEvaluatorService`
 * loads provisional-past-probation segments, builds a {@link ProbationInput}
 * per row, and applies the resulting {@link ProbationVerdict} under the
 * Phase-3 flags.
 */

/** Input to the pure {@link ProbationVerdict} decision. */
export interface ProbationInput {
  /** The candidate segment id (echoed onto the verdict for traceability). */
  segmentId: string;
  /**
   * Rolling-window usefulness ratio in `[0, 1]`, or `null` when the segment
   * has received no votes yet (distinct from `0`).
   */
  usefulness: number | null;
  /** Total usefulness votes in the window behind {@link usefulness}. */
  sampleSize: number;
  /** The segment's read counter — `0` marks an unused auto-promotion. */
  accessCount: number;
  /** True when the segment was superseded (`superseded_by != null`). */
  contradicted: boolean;
  /** True when the segment drifted (`drift_detected_at != null`). */
  drifted: boolean;
  /**
   * True when the segment demonstrably changed behaviour / contributed to a
   * convergence success. There is NO persisted per-segment signal for this
   * yet (Phase-3 Task-6 carry-forward), so the evaluator passes `false`; the
   * usefulness path still drives confirm.
   */
  injectedAndHelped: boolean;
  /**
   * End of the probation window in epoch-ms, or `null` when the segment
   * carries no parseable `probation_until`. A row whose window has not
   * elapsed (`probationUntilMs > nowMs`) always holds.
   */
  probationUntilMs: number | null;
}

/** Resolved, operator-tunable thresholds the pure decision consumes. */
export interface ProbationThresholds {
  /** Usefulness ratio at/above which a past-probation segment is confirmed. */
  confirmThreshold: number;
  /** Minimum votes before usefulness can drive a confirm / revert verdict. */
  minSamples: number;
}

/**
 * The probation verdict. `confirm` flips `governance_state` to `confirmed`;
 * `revert` archives the bad auto-promotion (flag-gated, archive-only);
 * `hold` leaves the segment untouched for a future pass.
 */
export interface ProbationVerdict {
  segmentId: string;
  action: 'confirm' | 'revert' | 'hold';
  reason: string;
  usefulness: number | null;
  sampleSize: number;
}
