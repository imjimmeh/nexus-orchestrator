import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateRuntimeFeedbackSignalGroups20260517100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS runtime_feedback_signal_groups (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        dedupe_fingerprint character varying(512) NOT NULL,
        signal_type character varying(80) NOT NULL,
        source_module character varying(120) NOT NULL,
        scope_type character varying(80) NOT NULL,
        scope_id character varying(160),
        actor_json jsonb NOT NULL DEFAULT '{}',
        affected_json jsonb NOT NULL DEFAULT '{}',
        evidence_json jsonb NOT NULL DEFAULT '[]',
        examples_json jsonb NOT NULL DEFAULT '[]',
        occurrence_count integer NOT NULL DEFAULT 0,
        window_occurrence_count integer NOT NULL DEFAULT 0,
        max_confidence double precision NOT NULL DEFAULT 0,
        max_severity character varying(20) NOT NULL,
        first_seen_at timestamptz NOT NULL,
        window_started_at timestamptz NOT NULL,
        last_seen_at timestamptz NOT NULL,
        candidate_id UUID,
        candidate_created_at timestamptz,
        cooldown_until timestamptz,
        last_skipped_reason character varying(160),
        diagnostics_json jsonb,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_runtime_feedback_signal_groups_fingerprint
      ON runtime_feedback_signal_groups(dedupe_fingerprint);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_runtime_feedback_signal_groups_type_scope
      ON runtime_feedback_signal_groups(signal_type, scope_type, scope_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_runtime_feedback_signal_groups_candidate
      ON runtime_feedback_signal_groups(candidate_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TABLE IF EXISTS runtime_feedback_signal_groups',
    );
  }
}
