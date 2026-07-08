import type { Repository } from 'typeorm';
import type { Logger as NestLogger } from '@nestjs/common';
import type { EventLedgerService } from '../observability/event-ledger.service';
import type { MemorySegment } from './database/entities/memory-segment.entity';
import { MEMORY_DRIFT_EVENT_NAME } from './memory-drift.constants';
import type { MemoryDriftDetectionResult } from './memory-drift.types';

/**
 * Row persistence and event emission for the
 * `MemoryDriftDetectionService` (work item
 * 0cead042-e823-4e26-9386-02042252ffb0).
 *
 * Splitting the persistence / event-emit helpers out of the
 * service file keeps the service focused on its main flow and
 * lets the milestone-4 test file exercise each helper
 * independently. The helpers are intentionally side-effectful:
 *
 *   - `persistDriftOnSegment` mutates the supplied
 *     `MemorySegment` (loading is the caller's responsibility)
 *     and calls `repository.save(...)` to commit the update.
 *     The mutation is idempotent: re-applying the same result
 *     to the same row is a no-op.
 *   - `emitDriftEventBestEffort` writes the
 *     `memory.segment.drift_detected.v1` event to the event
 *     ledger, swallowing transient failures so a ledger outage
 *     does not roll back the row update.
 */

/**
 * Persist a drift detection on a row. The detector never deletes
 * a row and never clears `drift_detected_at` — once drifted,
 * always marked, even if the operator later corrects the
 * underlying reality. The update is performed via the row's
 * loaded entity so TypeORM's `@UpdateDateColumn` writeback fires
 * as expected.
 */
export async function persistDriftOnSegment(
  repository: Repository<MemorySegment>,
  candidate: MemorySegment,
  result: MemoryDriftDetectionResult,
): Promise<void> {
  candidate.drift_detected_at = result.checkedAt;
  if (result.newConfidence !== null) {
    candidate.metadata_json = {
      ...(candidate.metadata_json ?? {}),
      confidence: result.newConfidence,
    };
  }
  await repository.save(candidate);
}

/**
 * Best-effort emit of the `memory.segment.drift_detected.v1`
 * observability event. The row update has already happened by
 * the time this is called; a failure to emit is logged but does
 * not roll back the update. Audit consumers will see a missing
 * event for the segment, which is preferable to a half-updated
 * state.
 */
export async function emitDriftEventBestEffort(
  eventLedger: EventLedgerService | undefined,
  logger: NestLogger,
  candidate: MemorySegment,
  result: MemoryDriftDetectionResult,
): Promise<void> {
  if (!eventLedger) {
    return;
  }
  try {
    await eventLedger.emitBestEffort({
      domain: 'memory',
      eventName: MEMORY_DRIFT_EVENT_NAME,
      outcome: 'success',
      payload: {
        segmentId: result.segmentId,
        referenceKind: result.referenceKind,
        reference: result.reference,
        originalConfidence: result.originalConfidence,
        newConfidence: result.newConfidence,
        reason: result.reason,
        source: candidate.source ?? null,
        driftDetectedAt: result.checkedAt.toISOString(),
      },
    });
  } catch (error) {
    const err = error as Error;
    logger.warn(
      `Failed to emit ${MEMORY_DRIFT_EVENT_NAME} for segment ${result.segmentId}: ${err.message}`,
    );
  }
}
