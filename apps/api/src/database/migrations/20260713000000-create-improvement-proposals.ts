import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateImprovementProposals20260713000000 implements MigrationInterface {
  name = 'CreateImprovementProposals20260713000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS improvement_proposals (
        id uuid NOT NULL DEFAULT uuid_generate_v4(),
        kind character varying(48) NOT NULL,
        status character varying(32) NOT NULL DEFAULT 'pending',
        payload jsonb NOT NULL,
        evidence jsonb NOT NULL,
        confidence double precision NOT NULL DEFAULT 0,
        rollback_data jsonb,
        occurrence_count integer NOT NULL DEFAULT 1,
        provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
        applied_at TIMESTAMPTZ,
        rolled_back_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_improvement_proposals PRIMARY KEY (id)
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_improvement_proposals_kind_status
        ON improvement_proposals (kind, status);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_improvement_proposals_status_created_at
        ON improvement_proposals (status, created_at);
    `);

    // Migrate existing skill_improvement_proposals rows into the new table as
    // kind='skill_create', mapping legacy columns into the generic payload.
    // Guarded by to_regclass so re-running this migration (or running it
    // against a database that never had the legacy table) is a no-op here
    // instead of a hard "relation does not exist" error.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF to_regclass('public.skill_improvement_proposals') IS NOT NULL THEN
          INSERT INTO improvement_proposals
            (id, kind, status, payload, evidence, confidence, provenance, applied_at, created_at, updated_at)
          SELECT
            sip.id,
            'skill_create',
            CASE WHEN sip.status IN ('pending','approved','rejected','applied','failed') THEN sip.status ELSE 'pending' END,
            jsonb_build_object(
              'target_skill_name', sip.target_skill_name,
              'proposal_title', sip.proposal_title,
              'proposal_summary', sip.proposal_summary,
              'patch_markdown', sip.patch_markdown,
              'rationale', sip.rationale,
              'assignment_targets', '[]'::jsonb
            ),
            jsonb_build_object('evidenceClass', 'inference'),
            0,
            jsonb_build_object(
              'migrated_from', 'skill_improvement_proposals',
              'learning_candidate_id', sip.learning_candidate_id,
              'generated_from_run_id', sip.generated_from_run_id,
              'diagnostics', sip.diagnostics_json
            ),
            sip.applied_at,
            sip.created_at,
            sip.updated_at
          FROM skill_improvement_proposals sip
          ON CONFLICT (id) DO NOTHING;
        END IF;
      END $$;
    `);

    await queryRunner.query(
      `DROP TABLE IF EXISTS skill_improvement_proposals;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Irreversible data migration: recreating the legacy table is out of scope.
    await queryRunner.query(`DROP TABLE IF EXISTS improvement_proposals;`);
  }
}
