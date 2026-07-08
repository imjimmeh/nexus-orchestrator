/**
 * Priority lanes the cheap deterministic gate assigns to a queued
 * retrospective row. The drain (Phase-2 Task 3) claims rows highest-priority
 * first; `bypass` short-circuits the drain window for high-signal failures.
 */
export type RetrospectivePriority = 'bypass' | 'high' | 'normal' | 'low';

/**
 * The deterministic interest verdict for a single terminal run.
 *
 * `score` is a 0–1 interest weight, `priority` is the lane derived from it,
 * `reasons` are human-readable signal tags (e.g. `recovered_struggle:<tool>`),
 * and `evidenceEventIds` are `event_ledger` row ids that back the verdict.
 * Evidence ids are ALWAYS ledger-derived — never invented; a signal with no
 * backing ledger row contributes no id.
 */
export interface InterestScore {
  score: number;
  priority: RetrospectivePriority;
  reasons: string[];
  evidenceEventIds: string[];
}
