import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the `retrospective_queue` table — the durable hand-off between a
 * terminal workflow run and the EPIC-212 Phase-2 retrospective analyst.
 *
 * Design:
 *  - One row per run: the UNIQUE index on `workflow_run_id` makes enqueue
 *    idempotent (a re-emitted terminal event is a no-op, not a duplicate).
 *  - `(status, priority, interest_score DESC)` index backs the drain's
 *    "claim the top-N highest-interest queued runs" query.
 *  - `scope_id` is nullable: failed runs may legitimately lack a scope; the
 *    listener flags the gap in `signals_json` rather than dropping the run.
 *  - Scope-neutral: `scope_id` is the only scope reference and
 *    `signals_json` carries no domain-specific identifiers.
 *
 * Idempotent (`CREATE TABLE / INDEX IF NOT EXISTS`); `down` drops the table.
 */
export class CreateRetrospectiveQueue20260704000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS retrospective_queue (
        "id"              uuid        NOT NULL DEFAULT uuid_generate_v4(),
        "workflow_run_id" uuid        NOT NULL,
        "scope_id"        varchar(160),
        "terminal_status" varchar(32) NOT NULL,
        "interest_score"  double precision NOT NULL DEFAULT 0,
        "priority"        varchar(16) NOT NULL DEFAULT 'normal',
        "status"          varchar(24) NOT NULL DEFAULT 'queued',
        "signals_json"    jsonb       NOT NULL DEFAULT '{}'::jsonb,
        "enqueued_at"     timestamptz NOT NULL DEFAULT now(),
        "drained_at"      timestamptz,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        "updated_at"      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_retrospective_queue_id" PRIMARY KEY ("id")
      );
    `);

    // Idempotent enqueue: one queue row per terminal run.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_retrospective_queue_workflow_run_id
        ON retrospective_queue ("workflow_run_id");
    `);

    // Drain query: highest-interest queued runs first.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_retrospective_queue_status_priority
        ON retrospective_queue ("status", "priority", "interest_score" DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS retrospective_queue;`);
  }
}
