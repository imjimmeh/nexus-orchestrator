import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { ScoringWeightVector } from '../../signals/feedback-weight-tuner.types';

/**
 * Versioned, reversible history of every weekly candidate-scoring weight
 * retune (EPIC-212 Phase-3 Task 9).
 *
 * Each row captures one `FeedbackWeightTunerService` pass: the new
 * (post-clamp) weight vector, the live weights it replaced, the labelled
 * sample size the retrain saw, the largest applied clamp delta, whether the
 * weights were actually persisted to the live scoring settings, and a short
 * reason. A revert re-applies `previous_weights_json` from a chosen row — no
 * recomputation, fully reversible.
 *
 * Maps the `signal_weight_history` table created by the
 * `20260708000000-create-signal-weight-history` migration.
 */
@Entity('signal_weight_history')
@Index('idx_signal_weight_history_applied_created', ['applied', 'created_at'])
export class SignalWeightHistory {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** The new (bounded) scoring-weight vector this pass produced. */
  @Column({ name: 'weights_json', type: 'jsonb' })
  weights_json!: ScoringWeightVector;

  /**
   * The live weights at the time of the pass. A revert re-applies this column
   * verbatim. Nullable only for defensiveness; the tuner always populates it.
   */
  @Column({ name: 'previous_weights_json', type: 'jsonb', nullable: true })
  previous_weights_json!: ScoringWeightVector | null;

  /** Number of labelled samples the retrain was computed over. */
  @Column({ name: 'training_sample_size', type: 'int', default: 0 })
  training_sample_size!: number;

  /** Largest per-weight change actually applied (clamp magnitude). */
  @Column({ name: 'bounded_delta', type: 'double precision', nullable: true })
  bounded_delta!: number | null;

  /** Whether the new weights were persisted to the live scoring settings. */
  @Column({ type: 'boolean', default: false })
  applied!: boolean;

  /** Short machine-readable reason (`retuned` | `insufficient_samples` | `revert`). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
