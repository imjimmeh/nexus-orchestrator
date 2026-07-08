import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SignalWeightHistory } from '../entities/signal-weight-history.entity';
import type { CreateSignalWeightHistoryInput } from './signal-weight-history.repository.types';

export type { CreateSignalWeightHistoryInput } from './signal-weight-history.repository.types';

/**
 * Persistence surface for the versioned candidate-scoring weight history
 * (EPIC-212 Phase-3 Task 9). Owns only the narrow read/write set the weekly
 * tuner + its revert path need.
 */
@Injectable()
export class SignalWeightHistoryRepository {
  constructor(
    @InjectRepository(SignalWeightHistory)
    private readonly repository: Repository<SignalWeightHistory>,
  ) {}

  /** Insert one history row and return the persisted entity (with `id`). */
  async create(
    input: CreateSignalWeightHistoryInput,
  ): Promise<SignalWeightHistory> {
    const entity = this.repository.create(input);
    return this.repository.save(entity);
  }

  /** Load a single history row by id, or `null` when absent. */
  async findById(id: string): Promise<SignalWeightHistory | null> {
    return this.repository.findOne({ where: { id } });
  }

  /**
   * Mark a history row as applied (the new weights were persisted to the live
   * settings). Idempotent — re-marking an already-applied row is a no-op.
   */
  async markApplied(id: string): Promise<void> {
    await this.repository.update({ id }, { applied: true });
  }

  /**
   * The most recently-created `applied=true` row — the anchor a `revertLatest`
   * re-applies the `previous_weights_json` of. Returns `null` when no retune
   * has ever been applied.
   */
  async findLatestApplied(): Promise<SignalWeightHistory | null> {
    return this.repository.findOne({
      where: { applied: true },
      order: { created_at: 'DESC' },
    });
  }

  /**
   * The most recent history rows (applied or not), newest first. Used by the
   * Learning Health surface / operator audit.
   */
  async findRecent(limit: number): Promise<SignalWeightHistory[]> {
    return this.repository.find({
      order: { created_at: 'DESC' },
      take: limit,
    });
  }
}
