/**
 * Exported result/config types for the retrospective drain (EPIC-212 Phase-2
 * Task 3). Interfaces live here (not in the service file) per the project's
 * `*.types.ts` convention.
 */

/** Resolved, coerced drain budget caps (one read per tick). */
export interface DrainBudget {
  budgetPerWindow: number;
  bypassBudget: number;
  interestFloor: number;
}

/**
 * Per-tick summary returned by `RetrospectiveDrainService.drainWindow()` so the
 * processor (and tests) can assert exactly how the claimed rows were dispatched
 * without inspecting the database.
 *
 * Invariant: `analyzed + skipped + failed + deferred === claimed`.
 *   - `deferred` counts rows claimed while the analysis port was ABSENT
 *     (Task 6 not yet wired) and reset back to `queued` so they are not lost.
 */
export interface DrainSummary {
  claimed: number;
  analyzed: number;
  skipped: number;
  failed: number;
  deferred: number;
}
