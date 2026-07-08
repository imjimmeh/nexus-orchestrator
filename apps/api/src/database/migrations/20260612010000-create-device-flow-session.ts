import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateDeviceFlowSession20260612010000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE device_flow_session (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        harness_id TEXT NOT NULL,
        credential_key TEXT NOT NULL,
        scope_node_id UUID,
        device_code TEXT NOT NULL,
        user_code TEXT NOT NULL,
        verification_uri TEXT NOT NULL,
        token_url TEXT NOT NULL,
        interval_seconds INT NOT NULL DEFAULT 5,
        status TEXT NOT NULL DEFAULT 'pending',
        secret_id UUID,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS device_flow_session`);
  }
}
