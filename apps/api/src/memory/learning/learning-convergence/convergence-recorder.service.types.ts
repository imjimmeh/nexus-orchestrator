/**
 * Type contracts for the daily convergence recorder service
 * (work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2).
 *
 * Splitting the contracts out of `convergence-recorder.service.ts`
 * keeps the service file focused and lets consumers import the
 * public surface without pulling in any I/O. The exported
 * interfaces / type aliases live here so the
 * `no-restricted-syntax` rule that forbids exported types in
 * non-`*.types.ts` files is satisfied.
 *
 * Re-exports the canonical closed-enum
 * `LearningMeasurementSnapshotSourceWindow` (defined in
 * `database/entities/learning-measurement-snapshot.entity.types.ts`)
 * under the recorder-facing alias `ConvergenceRecorderWindow`
 * so the recorder service does not have to import the
 * entity-types file directly.
 */

import type { LearningMeasurementSnapshotSourceWindow } from './database/entities/learning-measurement-snapshot.entity.types';
import type { LearningMeasurementSnapshot } from './database/entities/learning-measurement-snapshot.entity';
import type { MemoryRetentionPolicyUpsertResult } from './database/repositories/memory-retention-policy.repository';

/**
 * Closed enum of recorder operating windows (work item
 * 946a3c8b-5814-4e76-a804-b557e589600b, milestone 2, AC-1).
 * Mirrors the closed
 * `LearningMeasurementSnapshotSourceWindow` entity type; the
 * snapshot repository's `insertSnapshot(...)` is typed against
 * the entity type, so this alias is the recorder's contract
 * for "what windows does the recorder persist against?".
 */
export type ConvergenceRecorderWindow = LearningMeasurementSnapshotSourceWindow;

/**
 * Outcome the recorder reports to its caller (the cron
 * processor / scheduler) once a `tick()` pass completes.
 *
 *   - `'recorded'` — a `learning_measurement_snapshots` row was
 *     persisted and a `memory_retention_policy` upsert was
 *     attempted (the upsert may have been a no-op).
 *   - `'recorded_no_policy'` — the snapshot row was persisted
 *     but the recorder deliberately skipped the upsert (a
 *     reserved outcome for future milestone scenarios where
 *     the recorder is asked to skip the policy leg; today the
 *     orchestrator always calls
 *     `recordRetentionRecalibrationIfChanged`).
 *   - `'failed'` — the recorder caught an exception; the
 *     `ConvergenceRecorderTickError` carries the cause so the
 *     scheduler can decide whether to retry or alert.
 */
export type ConvergenceRecorderTickOutcome =
  | 'recorded'
  | 'recorded_no_policy'
  | 'failed';

/**
 * Successful result of one
 * {@link import('./convergence-recorder.service').ConvergenceRecorderService.tick}
 * call. The scheduler / caller can inspect
 * `outcome === 'recorded'` to know the snapshot was persisted
 * and the policy upsert was attempted; the `snapshot` and
 * `policyRow` are surfaced so the test surface can assert
 * against the persisted state without re-querying the
 * database.
 */
export interface ConvergenceRecorderTickResult {
  outcome: 'recorded' | 'recorded_no_policy';
  window: ConvergenceRecorderWindow | 'multi';
  snapshot: LearningMeasurementSnapshot;
  policyRow: MemoryRetentionPolicyUpsertResult | null;
}
