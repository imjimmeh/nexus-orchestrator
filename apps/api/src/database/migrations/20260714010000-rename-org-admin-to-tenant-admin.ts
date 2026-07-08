import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames the broad-role `org_admin` to `tenant_admin` (SDD §3.1). Guarded so
 * a DB where the row is absent, or already renamed, is a no-op. Description is
 * refreshed to match the new tenant framing.
 */
export class RenameOrgAdminToTenantAdmin20260714010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE roles
          SET name = 'tenant_admin',
              description = 'Full self-service within their tenant subtree'
        WHERE name = 'org_admin'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE roles
          SET name = 'org_admin',
              description = 'Manage an organization subtree'
        WHERE name = 'tenant_admin'`,
    );
  }
}
