import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * TypeORM entity for the explicit agent usefulness feedback
 * channel (work item 66ea23d1-59f2-451b-a090-a292fad8f21b,
 * milestone 1).
 *
 * One row per `useful` / `not_useful` vote cast by an agent on
 * a specific `memory_segments.id`. The TypeORM migration that
 * created the underlying table lives at
 * `apps/api/src/database/migrations/20260626000000-create-memory-segment-feedback.ts`.
 *
 * Decoration style mirrors the sibling memory-domain entities
 * (`MemorySegment`, `LearningCandidate`):
 *   - `@PrimaryGeneratedColumn('uuid')` for the surrogate id.
 *   - `@Column({ type, length, nullable })` for typed varchar /
 *     text / boolean columns; the column names are snake_case
 *     to match the underlying PostgreSQL column casing.
 *   - `@Index(['col_a', 'col_b'])` decorators for composite
 *     indexes that the migration creates by raw SQL — the
 *     decorator metadata keeps TypeORM's reflection-based
 *     schema sync in lock-step with the migration when the
 *     database is running in development mode.
 *   - `@CreateDateColumn` for the `created_at` wall-clock
 *     timestamp (the migration sets the same column with a
 *     `DEFAULT now()` so inserts that omit the field still get
 *     a server-side timestamp).
 *
 * `reason` is a free-form text field — the schema does NOT
 * constrain it to a closed set of values. The `text` type
 * avoids any Postgres "value too long" surprises on long
 * rationales. The follow-up service milestone (Milestone 2) is
 * expected to apply a length cap on the application side
 * before insert (the work item's `MemorySegmentFeedbackInput`
 * contract will reject rationales above the cap at the
 * boundary, keeping the database column permissive).
 */
@Entity('memory_segment_feedback')
@Index('idx_memory_segment_feedback_segment_id_created_at', [
  'segment_id',
  'created_at',
])
@Index('idx_memory_segment_feedback_agent_profile_id_created_at', [
  'agent_profile_id',
  'created_at',
])
@Index('idx_memory_segment_feedback_workflow_run_id', ['workflow_run_id'])
@Index('idx_memory_segment_feedback_query_id', ['query_id'])
export class MemorySegmentFeedback {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * Foreign-key reference to `memory_segments.id` (UUID). The
   * project does not declare a TypeORM `@ManyToOne` relation
   * here on purpose: the milestone-2 service needs to write
   * feedback for segments that the API has cached but not
   * re-fetched, and the database foreign key alone (added by a
   * follow-up milestone once the referential story is
   * settled) is the safest way to keep the two tables
   * consistent without forcing a TypeORM-level join.
   */
  @Column({ type: 'uuid' })
  segment_id!: string;

  /**
   * Identifier of the originating `query_memory` call. Stored
   * as `varchar(160)` — the identifier is externally supplied
   * (not a UUID) and the length cap matches the existing
   * `learning_candidate.scope_id` convention. NOT NULL.
   */
  @Column({ type: 'varchar', length: 160 })
  query_id!: string;

  /**
   * Agent profile name that cast the vote. Stored as
   * `varchar(160)` to mirror the existing
   * `delegation_contracts.requester_agent_profile` column
   * type. NOT NULL.
   */
  @Column({ type: 'varchar', length: 160 })
  agent_profile_id!: string;

  /**
   * Originating workflow run UUID. Matches the modern
   * `workflow_runs.id` UUID column type and the recent
   * per-table convention (e.g.
   * `user_question_awaits.workflow_run_id`,
   * `agent_await.parent_run_id`). NOT NULL.
   */
  @Column({ type: 'uuid' })
  workflow_run_id!: string;

  /**
   * The vote itself: `true` = useful, `false` = not useful.
   * NOT NULL — the channel is meaningless without the vote.
   */
  @Column({ type: 'boolean' })
  useful!: boolean;

  /**
   * Optional free-text rationale supplied by the agent at vote
   * time. `text` to avoid Postgres "value too long" surprises
   * on long rationales; nullable so a vote without a
   * justification inserts cleanly.
   */
  @Column({ type: 'text', nullable: true })
  reason!: string | null;

  /**
   * Wall-clock timestamp the vote was recorded. The migration
   * sets the same column with a `DEFAULT now()` so inserts
   * that omit the field still get a server-side timestamp.
   * Indexed together with `segment_id` and `agent_profile_id`
   * so the rolling-window aggregation the milestone-2 service
   * runs on every refresh tick is bounded by the composite
   * index instead of doing a sequential scan + filter.
   */
  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
