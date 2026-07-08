import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create the `memory_segment_feedback` table for the explicit
 * agent usefulness feedback channel (work item
 * 66ea23d1-59f2-451b-a090-a292fad8f21b, milestone 1).
 *
 * The `query_memory` workflow tool currently lacks an explicit
 * "was this useful?" signal from the agent — agents can call
 * `query_memory` but the only downstream telemetry is implicit
 * (whether a segment is later read again). That gap blocks the
 * memory-quality feedback loop: without an explicit
 * usefulness signal we cannot compute a per-segment
 * `usefulness_ratio` and weight retrieval / promotion
 * accordingly.
 *
 * This migration introduces the persistence half of the channel:
 *
 *   - One row per `useful` / `not_useful` vote cast by an agent
 *     on a specific `memory_segments.id`.
 *   - `segment_id` is the foreign-key reference back to
 *     `memory_segments.id` (UUID; matches the existing
 *     `memory_segments.id` column type).
 *   - `query_id` carries the originating `query_memory`
 *     identifier so we can later correlate "this query returned
 *     segments A/B/C" with "the agent then voted useful on A"
 *     during the same call. Stored as `varchar(160)` — the
 *     identifier is externally supplied (not a UUID) and the
 *     length cap matches the existing
 *     `learning_candidate.scope_id` / `user_question_awaits.job_id`
 *     convention. NOT NULL: every vote must reference the
 *     query that surfaced the segment.
 *   - `agent_profile_id` is the agent profile name (varchar(160)
 *     — mirrors the existing `delegation_contracts.requester_agent_profile`
 *     column type, NOT the `agent_profiles.id` UUID). NOT NULL:
 *     the channel is meaningless without knowing which agent
 *     cast the vote.
 *   - `workflow_run_id` is the originating workflow run UUID —
 *     matches the modern `workflow_runs.id` UUID column type and
 *     the recent per-table convention (e.g.
 *     `user_question_awaits.workflow_run_id`,
 *     `agent_await.parent_run_id`). NOT NULL: every vote must
 *     reference a concrete run for traceability.
 *   - `useful` is the boolean vote (true = useful, false = not
 *     useful). NOT NULL — the channel is meaningless without the
 *     vote.
 *   - `reason` is an optional free-text justification supplied
 *     by the agent at vote time. NULL when the agent votes
 *     without a rationale. Bounded by `text` to avoid truncation
 *     surprises on long rationales.
 *   - `created_at` is the wall-clock timestamp the vote was
 *     recorded. Indexed together with `segment_id` and
 *     `agent_profile_id` so the rolling-window aggregation
 *     (milestone 2) is bounded by the composite index instead
 *     of doing a sequential scan + filter.
 *
 * Indexes:
 *   - `(segment_id, created_at)` — supports the rolling-window
 *     `usefulness_ratio = count(useful) / count(*) WHERE
 *     segment_id = ? AND created_at >= :windowStart` aggregation
 *     the milestone-2 service runs on every refresh tick.
 *   - `(agent_profile_id, created_at)` — supports per-agent
 *     analytics queries (which agent is providing the most /
 *     least useful votes) without a full scan.
 *   - `(workflow_run_id)` — supports per-run debugging (which
 *     votes did run X cast) and the milestone-3 tool
 *     integration that needs to back-fill votes when a run
 *     completes.
 *   - `(query_id)` — supports the per-query correlation query
 *     (which votes came from query Y).
 */
export class CreateMemorySegmentFeedback20260626000000 implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS memory_segment_feedback (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "segment_id" uuid NOT NULL,
        "query_id" varchar(160) NOT NULL,
        "agent_profile_id" varchar(160) NOT NULL,
        "workflow_run_id" uuid NOT NULL,
        "useful" boolean NOT NULL,
        "reason" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_memory_segment_feedback_id" PRIMARY KEY ("id")
      );
    `);

    // Composite index on (segment_id, created_at) — supports the
    // rolling-window aggregation the milestone-2 service runs
    // on every refresh tick. The composite ordering matches the
    // query shape (`WHERE segment_id = ? AND created_at >= ?`)
    // so the planner can satisfy both predicates from the
    // index without scanning the heap.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_memory_segment_feedback_segment_id_created_at"
        ON memory_segment_feedback ("segment_id", "created_at");
    `);

    // Composite index on (agent_profile_id, created_at) —
    // supports per-agent analytics queries. Same composite-
    // ordering rationale as the segment_id index above.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_memory_segment_feedback_agent_profile_id_created_at"
        ON memory_segment_feedback ("agent_profile_id", "created_at");
    `);

    // Index on (workflow_run_id) — supports per-run debugging
    // ("which votes did run X cast?") and the milestone-3 tool
    // integration that needs to back-fill votes when a run
    // completes. A plain b-tree is sufficient — the column is
    // monotonic-ish (always increasing) and the cardinality is
    // high (one row per run).
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_memory_segment_feedback_workflow_run_id"
        ON memory_segment_feedback ("workflow_run_id");
    `);

    // Index on (query_id) — supports per-query correlation
    // ("which votes came from query Y?"). The column is
    // varchar(160) (an externally-supplied identifier, not a
    // UUID), so cardinality depends on the caller; a plain
    // b-tree keeps the lookup cheap regardless.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_memory_segment_feedback_query_id"
        ON memory_segment_feedback ("query_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS memory_segment_feedback;`);
  }
}
