import type { MigrationInterface, QueryRunner } from 'typeorm';

export class DropHarnessSecretRefs20260612030000 implements MigrationInterface {
  name = 'DropHarnessSecretRefs20260612030000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "harness_definition" DROP COLUMN IF EXISTS "secret_refs"`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "harness_definition" ADD COLUMN IF NOT EXISTS "secret_refs" jsonb`,
    );
  }
}
