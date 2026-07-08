/**
 * Shared types for `PostmortemWriter` (work item
 * 71cdcd7b-daff-489d-b681-44d239765c99, milestone 2).
 *
 * The writer's exported discriminated result and input shapes
 * live here so the file conforms to the project's
 * `no-restricted-syntax` lint rule, which keeps exported types
 * in dedicated `*.types.ts` files. Downstream consumers (the
 * postmortem listener after milestone 4 wires it in; future
 * listeners / controllers that need the same writeback
 * contract) can import from this module without taking a
 * dependency on the writer implementation.
 */
import type { FailureClassificationDecision } from './failure-classification.types';
import type { WorkflowRunEvent } from '../workflow-events.types';
import type { WorkflowPostmortemPayload } from './workflow-failure-postmortem.types';

/**
 * Discriminated result returned by `PostmortemWriter.writePostmortem`.
 *
 * The four kinds map 1:1 onto the postmortem writeback outcomes
 * the listener surfaces via `memory.workflow.postmortem_recorded.v1`:
 *   - `ok`      — a fresh memory segment was created and persisted.
 *                  `segmentId` carries the new row's id.
 *   - `skipped` — the write was suppressed because the dedup probe
 *                  found an existing postmortem for the same
 *                  `workflow_run_id` in the same project scope.
 *                  `reason` is `'duplicate-workflow-run-id'`.
 *   - `failed`  — a pre-write validation step rejected the
 *                  payload (e.g. `isWorkflowPostmortemPayload`
 *                  returned `false` because the listener built a
 *                  malformed shape). `reason` is the validation
 *                  diagnostic.
 *   - `error`   — the memory backend rejected the write. `reason`
 *                  carries the underlying error message verbatim
 *                  so the listener can log / surface it without
 *                  re-throwing.
 *
 * The distinction between `failed` and `error` lets the listener
 * log different severity (validation failure is a developer bug;
 * a backend rejection is a runtime condition). Both branches
 * internally route through `recordFailed` so the prom counter,
 * memory-metrics snapshot, and dual-event emit all fire
 * uniformly.
 */
export type WritePostmortemResult =
  | { kind: 'ok'; segmentId: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'error'; reason: string };

/**
 * Input shape for `PostmortemWriter.writePostmortem`. The listener
 * (or any future caller) passes the already-resolved payload +
 * classification decision + originating event so the writer can
 * emit the recorded-event surfaces with full context.
 */
export interface WritePostmortemInput {
  payload: WorkflowPostmortemPayload;
  decision: FailureClassificationDecision;
  event: WorkflowRunEvent;
}
