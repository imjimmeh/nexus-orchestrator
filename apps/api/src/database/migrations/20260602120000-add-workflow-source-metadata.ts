import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowSourceMetadata20260602120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE workflows
        ADD COLUMN IF NOT EXISTS source_type character varying(32) NOT NULL DEFAULT 'user',
        ADD COLUMN IF NOT EXISTS scope_id uuid,
        ADD COLUMN IF NOT EXISTS source_path character varying(512),
        ADD COLUMN IF NOT EXISTS source_ref character varying(255),
        ADD COLUMN IF NOT EXISTS source_hash character varying(128);
    `);

    await queryRunner.query(`
      ALTER TABLE workflows
        ADD CONSTRAINT chk_workflows_source_type
        CHECK (source_type IN ('seed', 'user', 'repository'));
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_workflows_source_scope
        ON workflows(source_type, scope_id);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_workflows_repository_scope_path
        ON workflows(scope_id, source_path)
        WHERE source_type = 'repository'
          AND scope_id IS NOT NULL
          AND source_path IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_workflows_repository_scope_path',
    );
    await queryRunner.query('DROP INDEX IF EXISTS idx_workflows_source_scope');

    await queryRunner.query(
      'ALTER TABLE workflows DROP CONSTRAINT IF EXISTS chk_workflows_source_type',
    );

    await queryRunner.query(`
      ALTER TABLE workflows
        DROP COLUMN IF EXISTS source_hash,
        DROP COLUMN IF EXISTS source_ref,
        DROP COLUMN IF EXISTS source_path,
        DROP COLUMN IF EXISTS scope_id,
        DROP COLUMN IF EXISTS source_type;
    `);
  }
}
