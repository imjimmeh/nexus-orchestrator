import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  BeforeInsert,
} from 'typeorm';
import { IMemorySegment } from '@nexus/core';

/**
 * Hard upper bound on the `source` column length, kept in sync with the
 * `varchar(64)` definition on the `source` column. Reused by the
 * `syncSourceFromMetadata` lifecycle hook so a malformed or malicious
 * `metadata_json.source` value can never blow past the column width
 * and trigger a Postgres "value too long" rejection on insert.
 */
const MEMORY_SEGMENT_SOURCE_MAX_LENGTH = 64;

@Entity('memory_segments')
@Index(['entity_type', 'entity_id'])
export class MemorySegment implements IMemorySegment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  entity_type: string;

  @Column()
  entity_id: string;

  @Column({
    type: 'enum',
    enum: ['preference', 'fact', 'history', 'strategic_intent'],
    default: 'fact',
  })
  // `strategic_intent` is the singleton per-entity CEO long-term planning
  // record introduced in EPIC-208 (Milestone 1). The structured payload
  // (horizon, priority_themes, focus_areas, constraints, updated_at,
  // updated_by) lives in `metadata_json`; see `strategicIntentBodySchema`
  // in `@nexus/core/schemas/workflow-runtime-inputs.schemas`.
  memory_type: 'preference' | 'fact' | 'history' | 'strategic_intent';

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'int', default: 1 })
  version: number;

  @Column({ type: 'jsonb', nullable: true })
  metadata_json: Record<string, unknown> | null;

  /**
   * Wall-clock timestamp of the most recent read of this segment. The
   * nightly MemoryEvictionReaper treats `null` as "never touched" — a
   * row whose `last_accessed_at` is null is eligible for eviction once
   * its `created_at` is older than the configured max-idle-days window.
   *
   * Application writers are expected to bump this column on every read
   * that returns the segment. Reads that bypass the API (raw SQL, ad-hoc
   * reports) will not refresh the timestamp; that is intentional — the
   * reaper is conservative and prefers a few extra writes over silently
   * deleting still-warm memory.
   */
  @Column({ type: 'timestamptz', nullable: true })
  last_accessed_at: Date | null;

  /**
   * Monotonically-increasing counter of successful reads. The nightly
   * MemoryEvictionReaper preserves any row whose `access_count` is at or
   * above `memory_segment_eviction_min_access_count`, regardless of how
   * stale the row is — segments that have been read at least once are
   * treated as load-bearing. Defaults to 0 (never read).
   */
  @Column({ type: 'int', default: 0 })
  access_count: number;

  /**
   * Operator-driven pin flag. Pinned rows are NEVER auto-evicted by
   * the reaper, even when they match the idle-days / access-count
   * criteria and even when their `source` is not in the protected
   * allowlist. Defaults to false. The reaper treats `pinned = true`
   * as an absolute short-circuit.
   */
  @Column({ type: 'boolean', default: false })
  pinned: boolean;

  /**
   * Coarse classification of where this segment came from. Used by the
   * nightly MemoryEvictionReaper to skip rows whose `source` appears
   * in the `memory_segment_eviction_protected_sources` allowlist
   * (defaults to `learning_candidate`). Nullable so existing rows
   * written before the column was added remain valid; the reaper
   * treats null source as evictable.
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  source: string | null;

  /**
   * Wall-clock timestamp of the most recent "explicit reinforcement"
   * of this segment. Bumped by `MemoryManagerService` (best-effort,
   * fire-and-forget) on every successful read of a segment via
   * `getMemorySegments` / `searchMemory`. The follow-up nightly
   * `MemoryDecayReaper` uses
   * `max(last_accessed_at, last_reinforced_at)` as the "effective
   * last touch" so frequently-consumed segments stay fresh and
   * avoid spurious confidence decay (work item
   * 3d7fb798-f54d-40ff-a803-438224474912).
   *
   * Nullable: a null value is treated as "never reinforced" by the
   * reaper and the eviction-style `last_accessed_at` (or `created_at`
   * fallback) is used instead.
   */
  @Column({ type: 'timestamptz', nullable: true })
  last_reinforced_at: Date | null;

  /**
   * Wall-clock timestamp at which the `MemoryDecayReaper` archived
   * this segment because its decayed `metadata_json.confidence`
   * fell below the `memory_decay_floor` threshold. Nullable: a
   * null value is treated as "active" by the reaper. The reaper
   * NEVER deletes archived rows — they are preserved for
   * auditability.
   *
   * Indexed via the partial index
   * `idx_memory_segments_archived_at`
   * (`WHERE archived_at IS NULL`) added by the
   * `20260623000000-add-memory-segment-decay-columns` migration,
   * so the reaper's hot candidate filter `WHERE archived_at IS NULL`
   * stays cheap as the archived subset grows. The plain
   * `idx_memory_segments_last_reinforced_at` b-tree index on the
   * sibling column is added in the same migration to keep the
   * reaper's `last_reinforced_at` ordering step off a sequential
   * scan.
   */
  @Column({ type: 'timestamptz', nullable: true })
  archived_at: Date | null;

  /**
   * Wall-clock timestamp at which the `MemoryDriftDetectionService`
   * flagged this segment as drifted because the underlying reality
   * (a file path, schema column, or API endpoint the segment's
   * `source_metadata` references) no longer matches the codebase.
   * Nullable: a `null` value is treated as "never detected as
   * drifted" by the reaper (and downstream consumers).
   *
   * When the drift detector fires, it stamps this column with
   * `NOW()` alongside the confidence penalty applied to
   * `metadata_json.confidence`. The detector never clears the
   * column — a segment that has drifted once is permanently marked
   * for auditability, even if the operator later corrects the
   * underlying reality (operators can manually update the row).
   *
   * Indexed via the partial index
   * `idx_memory_segments_drift_detected_at_unset`
   * (`WHERE drift_detected_at IS NULL`) added by the
   * `20260626000000-add-memory-drift-detected-at` migration, so
   * the detector's hot candidate filter `WHERE drift_detected_at
   * IS NULL` stays cheap as the drifted subset grows.
   *
   * @see apps/api/src/memory/memory-drift.constants.ts — exempt sources
   * @see work item 0cead042-e823-4e26-9386-02042252ffb0
   */
  @Column({ type: 'timestamptz', nullable: true })
  drift_detected_at: Date | null;

  /**
   * Governance lifecycle state (EPIC-212 Phase-2 Task 9). One of:
   *   - `provisional` — an auto-promoted segment still inside its probation
   *     window. `PromotionGovernancePolicyService` stamps this (plus a
   *     `metadata_json.probation_until`) on every route-aware auto-promotion;
   *     the Phase-3 probation evaluator later confirms or reverts it.
   *   - `confirmed` — a settled, durable segment.
   *   - `null` — a legacy row written before governance existed. Readers
   *     treat a null value as confirmed.
   *
   * Nullable so every pre-existing row remains valid without a backfill.
   */
  @Column({ type: 'varchar', length: 24, nullable: true })
  governance_state: string | null;

  /**
   * Forward supersession link (EPIC-212 Phase-3 Task 5). When this segment
   * supersedes an older, contradicting segment, `supersedes` holds the UUID of
   * the segment it replaced. Self-referential UUID with NO foreign-key
   * constraint (the `20260707000000` migration stores the raw UUID to avoid
   * insert-ordering issues). Nullable so every pre-existing row remains valid
   * without a backfill; a null value means "this segment supersedes nothing".
   */
  @Column({ type: 'uuid', nullable: true })
  supersedes: string | null;

  /**
   * Reverse supersession link (EPIC-212 Phase-3 Task 5). When a newer,
   * contradicting segment supersedes this one, `superseded_by` holds the UUID
   * of the replacement and the `MemoryContradictionService` also stamps
   * `archived_at` (the loser is preserved for audit but invisible to reads).
   * Indexed via `idx_memory_segments_superseded_by`. Nullable so legacy rows
   * remain valid; a null value means "this segment is live / not superseded".
   */
  @Column({ type: 'uuid', nullable: true })
  superseded_by: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  /**
   * Backfill the column-level `source` from `metadata_json.source` when
   * the caller did not set it explicitly. Several call sites
   * (notably `WorkflowFailurePostmortemListener` and the auto-promoted
   * `learning_candidate` flow) classify a segment by tagging the
   * `metadata_json.source` key, but the column-level `source` is what
   * the nightly `MemoryDecayReaper` and `MemoryEvictionReaper` use to
   * honour the protected-source allowlist
   * (`MEMORY_DECAY_EXEMPT_SOURCES`,
   * `memory_segment_eviction_protected_sources`). Without this hook a
   * postmortem would have a NULL `source` column and slip past the
   * column-level exemption check.
   *
   * Constraints:
   *   - Fires only when the `source` column is currently unset
   *     (idempotent — never overwrites an explicit value).
   *   - Only copies non-empty string values; numbers, booleans, null,
   *     objects, and missing keys are all left as `null` on the column.
   *   - Enforces the same `varchar(64)` length cap as the column
   *     definition to avoid Postgres insert-time "value too long"
   *     errors from a malformed `metadata_json.source`.
   *
   * @see apps/api/src/memory/memory-decay.constants.ts — exempt sources
   * @see apps/api/src/memory/memory-eviction.constants.ts — protected sources
   * @see apps/api/src/workflow/workflow-repair/workflow-failure-postmortem.listener.ts
   */
  @BeforeInsert()
  syncSourceFromMetadata(): void {
    if (this.source != null) {
      return;
    }
    if (this.metadata_json == null) {
      return;
    }
    const candidate = this.metadata_json.source;
    if (
      typeof candidate === 'string' &&
      candidate.length > 0 &&
      candidate.length <= MEMORY_SEGMENT_SOURCE_MAX_LENGTH
    ) {
      this.source = candidate;
    }
  }
}
