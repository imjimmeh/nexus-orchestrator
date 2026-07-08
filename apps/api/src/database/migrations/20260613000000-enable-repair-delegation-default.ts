import { MigrationInterface, QueryRunner } from 'typeorm';

const SETTING_KEY = 'workflow_repair_delegation_enabled';
const SETTING_DESCRIPTION =
  'Enable config-gated autonomous repair delegation for policy-allowed workflow failures';

export class EnableRepairDelegationDefault20260613000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO system_settings (key, value, description, updated_at)
       VALUES ($1, $2::jsonb, $3, now())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
      [SETTING_KEY, JSON.stringify(true), SETTING_DESCRIPTION],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE system_settings SET value = $2::jsonb, updated_at = now() WHERE key = $1`,
      [SETTING_KEY, JSON.stringify(false)],
    );
  }
}
