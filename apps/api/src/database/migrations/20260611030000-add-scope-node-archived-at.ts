import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScopeNodeArchivedAt20260611030000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE scope_nodes ADD COLUMN archived_at TIMESTAMPTZ NULL;`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE scope_nodes DROP COLUMN archived_at;`);
  }
}
