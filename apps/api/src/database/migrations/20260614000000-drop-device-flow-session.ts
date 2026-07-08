import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the device_flow_session table. The harness RFC 8628 device-flow service
 * was superseded by the unified SDK-backed OAuth login engine, which keeps
 * in-flight session state in memory and persists only the resulting credential
 * binding.
 */
export class DropDeviceFlowSession20260614000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS device_flow_session`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
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
}
