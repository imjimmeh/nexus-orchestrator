import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddExecutionLeaseColumns20260710000000 implements MigrationInterface {
  name = 'AddExecutionLeaseColumns20260710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE executions
      ADD COLUMN IF NOT EXISTS owner_instance_id character varying(128),
      ADD COLUMN IF NOT EXISTS owner_lease_expires_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS last_progress_at TIMESTAMP;
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_executions_state_owner_lease_expires_at
      ON executions(state, owner_lease_expires_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_executions_state_owner_lease_expires_at',
    );
    await queryRunner.query(`
      ALTER TABLE executions
      DROP COLUMN IF EXISTS last_progress_at,
      DROP COLUMN IF EXISTS owner_lease_expires_at,
      DROP COLUMN IF EXISTS owner_instance_id;
    `);
  }
}
