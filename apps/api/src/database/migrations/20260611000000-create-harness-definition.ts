import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHarnessDefinition20260611000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE harness_definition (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        harness_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'custom',
        capabilities JSONB NOT NULL DEFAULT '{}',
        image_ref TEXT NOT NULL DEFAULT '',
        transport TEXT NOT NULL DEFAULT 'kernel',
        endpoint_config JSONB,
        secret_refs JSONB NOT NULL DEFAULT '{}',
        default_env JSONB NOT NULL DEFAULT '{}',
        enabled BOOLEAN NOT NULL DEFAULT true,
        policy_scope JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX harness_definition_harness_id_idx ON harness_definition (harness_id)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS harness_definition`);
  }
}
