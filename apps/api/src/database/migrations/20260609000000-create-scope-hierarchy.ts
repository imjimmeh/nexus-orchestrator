import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateScopeHierarchy20260609000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scope_nodes (
        id uuid PRIMARY KEY,
        parent_id uuid NULL REFERENCES scope_nodes(id) ON DELETE RESTRICT,
        type varchar(32) NOT NULL,
        name varchar(255) NOT NULL,
        slug varchar(255) NOT NULL,
        metadata jsonb NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_scope_nodes_parent ON scope_nodes (parent_id);`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_scope_nodes_parent_slug ON scope_nodes (COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), slug);`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS scope_node_closure (
        ancestor_id uuid NOT NULL REFERENCES scope_nodes(id) ON DELETE CASCADE,
        descendant_id uuid NOT NULL REFERENCES scope_nodes(id) ON DELETE CASCADE,
        depth int NOT NULL,
        PRIMARY KEY (ancestor_id, descendant_id)
      );
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_scope_closure_descendant ON scope_node_closure (descendant_id);`,
    );

    // Global root node + self-closure row.
    await queryRunner.query(`
      INSERT INTO scope_nodes (id, parent_id, type, name, slug)
      VALUES ('00000000-0000-0000-0000-000000000000', NULL, 'platform', 'Platform', 'platform')
      ON CONFLICT (id) DO NOTHING;
    `);
    await queryRunner.query(`
      INSERT INTO scope_node_closure (ancestor_id, descendant_id, depth)
      VALUES ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-000000000000', 0)
      ON CONFLICT DO NOTHING;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT COUNT(*)::bigint AS count FROM scope_nodes WHERE id <> '00000000-0000-0000-0000-000000000000'`,
    )) as Array<{ count: bigint | string }>;
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Rollback unsafe: non-root scope_nodes exist. Remove scoped hierarchy before rolling back.',
      );
    }
    await queryRunner.query(`DROP TABLE IF EXISTS scope_node_closure;`);
    await queryRunner.query(`DROP TABLE IF EXISTS scope_nodes;`);
  }
}
