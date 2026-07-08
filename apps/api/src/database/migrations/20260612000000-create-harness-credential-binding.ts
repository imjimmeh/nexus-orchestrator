import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateHarnessCredentialBinding20260612000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE harness_credential_binding (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope_node_id UUID,
        harness_id TEXT NOT NULL,
        credential_key TEXT NOT NULL,
        auth_type TEXT NOT NULL,
        secret_id UUID NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX harness_credential_binding_scope_harness_key_idx
        ON harness_credential_binding (scope_node_id, harness_id, credential_key)
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX harness_credential_binding_platform_harness_key_idx
        ON harness_credential_binding (harness_id, credential_key)
        WHERE scope_node_id IS NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS harness_credential_binding`);
  }
}
