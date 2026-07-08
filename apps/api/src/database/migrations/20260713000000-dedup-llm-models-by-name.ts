import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collapses `llm_models` rows that share the same `name` down to a single
 * canonical row. A duplicate group predating the table's unique constraint
 * on `name` (e.g. two `MiniMax-M3` rows, one `default_for_execution=true`
 * and one `false`) makes `LlmModelRepository.findByName` nondeterministic —
 * it can return either row for the same name, ambiguously flipping which
 * default settings apply.
 *
 * Tie-break per name group:
 *   - Keep the row with `default_for_execution = true` when exactly one such
 *     row exists in the group.
 *   - Otherwise (zero, or more than one, `default_for_execution = true` row
 *     — an already-ambiguous state this migration must not compound) keep
 *     the oldest row by `created_at`.
 *   - All other rows in the group are deleted.
 *
 * Safe/idempotent: a table with no duplicate names has no row ranked > 1
 * within its `name` partition, so the DELETE affects zero rows.
 *
 * Implementation note: `true_count` is materialised in an inner CTE (`counts`)
 * as a plain column before being referenced by the outer `ROW_NUMBER()`'s
 * ORDER BY — Postgres does not allow nesting a window function directly
 * inside another window function's clauses, so the two window functions are
 * split across CTEs rather than composed in one SELECT.
 */
export class DedupLlmModelsByName20260713000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `WITH counts AS (
         SELECT
           id,
           name,
           default_for_execution,
           created_at,
           COUNT(*) FILTER (WHERE default_for_execution)
             OVER (PARTITION BY name) AS true_count
         FROM llm_models
       ),
       ranked AS (
         SELECT
           id,
           ROW_NUMBER() OVER (
             PARTITION BY name
             ORDER BY
               CASE
                 WHEN default_for_execution AND true_count = 1 THEN 0
                 ELSE 1
               END,
               created_at ASC,
               id ASC
           ) AS rn
         FROM counts
       )
       DELETE FROM llm_models
       WHERE id IN (SELECT id FROM ranked WHERE rn > 1)`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: deleted duplicate rows cannot be restored.
  }
}
