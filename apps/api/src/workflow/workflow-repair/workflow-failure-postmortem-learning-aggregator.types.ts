/**
 * Type contracts for `WorkflowPostmortemLearningAggregatorService`
 * (originally milestone 3 of work item 5743ac93-456d-41b3-ae5b-0ca2554318da).
 *
 * The service surfaces a single public method (`recordPostmortemRecurrence`)
 * whose input is the just-written postmortem's identity and whose output is a
 * discriminated result describing whether the recurrence threshold was crossed,
 * the count observed, and the threshold / window the service evaluated against.
 *
 * EPIC-212 Phase 2 (Task 12) retired the templated learning-candidate emitter
 * that used to fire on a threshold crossing; the recurrence count is preserved
 * as a deterministic Phase-2 gate signal (the retrospective analyst now mines
 * failures).
 *
 * The interfaces live in a dedicated `.types.ts` file to comply with the API's
 * lint policy (`no-restricted-syntax`) which forbids
 * `ExportNamedDeclaration > TSInterfaceDeclaration` outside of
 * `*.types.ts` / `types.ts`.
 */

/**
 * Input to `WorkflowPostmortemLearningAggregatorService.recordPostmortemRecurrence`.
 *
 *   - `scopeId`: the project / resource scope the just-written postmortem
 *     belongs to (resolved by the postmortem listener).
 *   - `failureClass`: the policy class the repair pipeline assigned
 *     (`dependency_missing`, `config_missing_local`, etc.).
 *   - `triggeredByWorkflowRunId`: the workflow run id that triggered
 *     this aggregation.
 *   - `triggeredAt`: the wall-clock instant the aggregation was
 *     requested; the service subtracts `windowDays` to anchor the
 *     count window.
 */
export interface PostmortemRecurrenceInput {
  scopeId: string;
  failureClass: string;
  triggeredByWorkflowRunId: string;
  triggeredAt: Date;
}

/**
 * Output of `WorkflowPostmortemLearningAggregatorService.recordPostmortemRecurrence`.
 *
 * `thresholdCrossed: true` means the postmortem occurrence count for the
 * `(scope_id, failure_class)` pair reached or exceeded the configured
 * threshold within the window — a deterministic recurrence gate signal (no
 * learning candidate is proposed; the retrospective analyst owns mining).
 *
 * `reason` is populated on the non-crossing paths so the caller can distinguish
 * `below-threshold` (the count is below the threshold — expected for the first
 * occurrences of a class) from `recurrence-error` (a settings read or DB count
 * threw, and the service swallowed it). Callers MUST NOT throw on
 * `recurrence-error`; the service has already logged the error.
 */
export interface PostmortemRecurrenceResult {
  thresholdCrossed: boolean;
  reason?: string;
  count?: number;
  threshold?: number;
  windowDays?: number;
}
