import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowCompositeUnique20260611010000 implements MigrationInterface {
  name = 'AddWorkflowCompositeUnique20260611010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "workflows" ADD COLUMN IF NOT EXISTS "base_workflow_id" uuid NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_workflow_name_scope" ON "workflows" ("name", "scope_node_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_workflow_name_scope"`);
    await queryRunner.query(
      `ALTER TABLE "workflows" DROP COLUMN IF EXISTS "base_workflow_id"`,
    );
  }
}
