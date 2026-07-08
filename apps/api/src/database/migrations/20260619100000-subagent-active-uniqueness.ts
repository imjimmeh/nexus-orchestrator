import { MigrationInterface, QueryRunner } from 'typeorm';

export class SubagentActiveUniqueness20260619100000 implements MigrationInterface {
  name = 'SubagentActiveUniqueness20260619100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE subagent_details ADD COLUMN IF NOT EXISTS role varchar`,
    );

    await queryRunner.query(
      `ALTER TABLE subagent_details ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true`,
    );

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_subagent_active_per_parent_role
      ON subagent_details(parent_container_id, role)
      WHERE is_active AND role IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_subagent_active_per_parent_role`,
    );

    await queryRunner.query(
      `ALTER TABLE subagent_details DROP COLUMN IF EXISTS is_active`,
    );

    await queryRunner.query(
      `ALTER TABLE subagent_details DROP COLUMN IF EXISTS role`,
    );
  }
}
