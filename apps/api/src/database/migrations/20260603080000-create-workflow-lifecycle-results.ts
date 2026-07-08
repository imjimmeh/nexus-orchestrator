import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkflowLifecycleResults20260603080000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_lifecycle_results (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_id UUID NOT NULL,
        context_id UUID,
        phase character varying(128) NOT NULL,
        hook character varying(32) NOT NULL,
        blocking_only boolean NOT NULL,
        aggregate_status character varying(32) NOT NULL,
        results jsonb NOT NULL,
        repository_ref character varying(255),
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_lifecycle_results_scope
        ON workflow_lifecycle_results(scope_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_lifecycle_results_scope_phase_hook
        ON workflow_lifecycle_results(scope_id, phase, hook, created_at DESC);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS workflow_lifecycle_results;');
  }
}
