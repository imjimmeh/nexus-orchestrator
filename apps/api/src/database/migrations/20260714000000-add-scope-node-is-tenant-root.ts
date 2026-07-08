import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddScopeNodeIsTenantRoot20260714000000 implements MigrationInterface {
  name = 'AddScopeNodeIsTenantRoot20260714000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scope_nodes" ADD COLUMN IF NOT EXISTS "is_tenant_root" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "scope_nodes" DROP COLUMN IF EXISTS "is_tenant_root"`,
    );
  }
}
