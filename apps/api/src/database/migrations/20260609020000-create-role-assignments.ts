import { MigrationInterface, QueryRunner } from 'typeorm';

const ROOT = '00000000-0000-0000-0000-000000000000';

export class CreateRoleAssignments20260609020000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS role_assignments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        scope_node_id uuid NOT NULL REFERENCES scope_nodes(id) ON DELETE CASCADE
      );
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_role_assignments_user_role_scope ON role_assignments (user_id, role_id, scope_node_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_role_assignments_user ON role_assignments (user_id);`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_role_assignments_scope ON role_assignments (scope_node_id);`,
    );
    await queryRunner.query(
      `ALTER TABLE roles ADD COLUMN IF NOT EXISTS owner_scope_node_id uuid NULL REFERENCES scope_nodes(id) ON DELETE CASCADE;`,
    );
    await queryRunner.query(
      `INSERT INTO role_assignments (user_id, role_id, scope_node_id)
       SELECT ur.user_id, ur.role_id, $1
         FROM user_roles ur
        WHERE NOT EXISTS (
          SELECT 1 FROM role_assignments ra
           WHERE ra.user_id = ur.user_id AND ra.role_id = ur.role_id AND ra.scope_node_id = $1
        )
       ON CONFLICT (user_id, role_id, scope_node_id) DO NOTHING;`,
      [ROOT],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT COUNT(*)::bigint AS count FROM role_assignments WHERE scope_node_id <> $1`,
      [ROOT],
    )) as Array<{ count: string | bigint }>;
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error(
        `Rollback is unsafe: non-root role_assignments exist. Remove scoped role assignments before rolling back.`,
      );
    }
    await queryRunner.query(
      `ALTER TABLE roles DROP COLUMN IF EXISTS owner_scope_node_id;`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS role_assignments;`);
  }
}
