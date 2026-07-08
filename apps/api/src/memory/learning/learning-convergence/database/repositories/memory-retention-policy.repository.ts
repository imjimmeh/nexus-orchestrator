import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { MemoryRetentionPolicy } from '../entities/memory-retention-policy.entity';
import type { MemoryRetentionPolicyUpsertResult } from './memory-retention-policy.repository.types';

export type {
  MemoryRetentionPolicyUpsertOutcome,
  MemoryRetentionPolicyUpsertResult,
} from './memory-retention-policy.repository.types';

/**
 * Persistence surface for the memory-retention-policy singleton
 * (work item 946a3c8b-5814-4e76-a804-b557e589600b, milestone 1).
 *
 * Mirrors the project's domain-local repository convention
 * (see `MemorySegmentFeedbackRepository`,
 * `LearningCandidateRepository`): the entity is imported via a
 * relative path within the same domain, the repository is
 * `@Injectable()` and delegates to TypeORM's `Repository<T>`
 * for the underlying SQL surface, and the read / write methods
 * are narrow and named for their caller-facing intent rather
 * than for the SQL they generate.
 *
 * The recorder reads / writes the singleton row each pass via
 * {@link getCurrent} / {@link upsertIfChanged}, so the
 * repository surface is intentionally minimal. The
 * {@link upsertIfChanged} method owns the
 * `Math.abs(new − current) < ε` threshold-equality check
 * INSIDE the database transaction so two concurrent recorder
 * passes cannot race the round trip into a stale
 * `recalibrated_at` bump.
 */
@Injectable()
export class MemoryRetentionPolicyRepository {
  constructor(
    @InjectRepository(MemoryRetentionPolicy)
    private readonly repository: Repository<MemoryRetentionPolicy>,
  ) {}

  /**
   * Look up the singleton row. Returns `null` when the row
   * has been removed (should not happen in production — the
   * migration seeds it — but the helper is the source of
   * truth for the "missing" case so the caller can decide
   * whether to fall back to a default or surface an error).
   */
  async getCurrent(): Promise<MemoryRetentionPolicy | null> {
    return this.repository.findOne({ where: { id: 1 } });
  }

  /**
   * Apply the recorder's proposed threshold + sample size in a
   * single transaction. The ε-comparison lives inside the
   * transaction so two concurrent recorder passes cannot
   * race:
   *
   *   - Pass A reads `current.threshold = 0.60`.
   *   - Pass B reads `current.threshold = 0.60`.
   *   - Pass A proposes 0.61 (|0.61 − 0.60| > ε). Pass B
   *     proposes 0.6001 (|0.6001 − 0.60| < ε).
   *   - Pass A writes 0.61 + bumps `recalibrated_at`.
   *     Pass B sees `current.threshold = 0.61` after A's
   *     commit, |0.6001 − 0.61| > ε, writes 0.6001 + bumps
   *     `recalibrated_at` — silently demoting the threshold.
   *   - The transactional read inside
   *     `repository.manager.transaction(...)` blocks Pass B's
   *     read until Pass A's write commits, so Pass B sees
   *     `current.threshold = 0.61` and the demotion is
   *     intentional (the recorder re-ran with a different
   *     signal).
   *
   * Returns:
   *   - `{ outcome: 'no_change', row }` when the proposed
   *     threshold is within `ε` of the current threshold
   *     (the existing `recalibrated_at` is preserved so the
   *     operator UI does not show a phantom "just
   *     recalibrated" event).
   *   - `{ outcome: 'applied', row }` when the threshold
   *     moved by at least `ε` and the row was updated with
   *     the new value, sample size, and a fresh
   *     `recalibrated_at`.
   *
   * The seed migration guarantees a singleton row exists, so
   * `current === null` is treated as the "applied" branch —
   * the recorder must not be allowed to no-op a fresh DB.
   */
  async upsertIfChanged(
    threshold: number,
    sampleSize: number,
    thresholdEpsilon: number,
  ): Promise<MemoryRetentionPolicyUpsertResult> {
    return this.repository.manager.transaction(async (manager) => {
      const current = await manager.findOne(MemoryRetentionPolicy, {
        where: { id: 1 },
      });
      if (current !== null) {
        const currentThreshold = Number(current.usefulness_threshold);
        if (
          Number.isFinite(currentThreshold) &&
          Math.abs(threshold - currentThreshold) < thresholdEpsilon
        ) {
          return { outcome: 'no_change', row: current };
        }
      }
      const persisted = await manager.save(
        manager.create(MemoryRetentionPolicy, {
          id: 1,
          usefulness_threshold: threshold.toString(),
          sample_size: sampleSize,
          recalibrated_at: new Date(),
        }),
      );
      return { outcome: 'applied', row: persisted };
    });
  }
}
