/**
 * Type surface for the memory-decay run orchestrator helpers
 * (`memory-decay.run-orchestrator.ts`).
 */
import type { Logger } from '@nestjs/common';
import type { MemorySegmentCrudRepository } from './database/repositories/memory-segment.crud.repository';
import type { MemorySegmentDecayRepository } from './database/repositories/memory-segment.decay.repository';
import type { MemorySegmentFeedbackService } from './memory-segment-feedback.service';
import type { EventLedgerService } from '../observability/event-ledger.service';
import type {
  DecayShadowCandidate,
  SegmentUsefulness,
} from './memory-decay.value-predicate.types';

/**
 * Dependencies the per-pass orchestrator needs in order to
 * walk the candidate list. All collaborators are passed
 * explicitly so the helper is trivially unit-testable (no DI
 * container, no `this` indirection). The `eventLedger` and
 * `feedback` slots are `@Optional()` on the owning service so
 * the helpers preserve the no-feedback / no-event-ledger
 * fallback paths.
 */
export interface MemoryDecayRunOrchestratorDeps {
  readonly decaySegments: MemorySegmentDecayRepository;
  readonly memorySegments: MemorySegmentCrudRepository;
  readonly feedback?: MemorySegmentFeedbackService | null;
  readonly eventLedger?: EventLedgerService | null;
  readonly logger: Logger;
}

/**
 * Aggregated counters produced by the per-row classification
 * loop. Mirrors the fields the reaper accumulated inline
 * before extraction so the post-loop metric / log / return
 * shape is byte-identical.
 */
export interface MemoryDecayRunAggregates {
  evaluated: number;
  decayed: number;
  archived: number;
  shadowCandidates: DecayShadowCandidate[];
  usefulnessForPredicate: Map<string, SegmentUsefulness> | null;
}

/**
 * Per-row outcome produced by `applyClassifiedOutcome`. The
 * post-loop tally code switches on this discriminator to
 * increment `evaluated` / `decayed` / `archived` counters.
 */
export type RowOutcome = 'decayed' | 'archived' | 'skipped';
