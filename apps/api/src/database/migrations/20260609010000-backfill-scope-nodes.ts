import { MigrationInterface, QueryRunner } from 'typeorm';

const ROOT = '00000000-0000-0000-0000-000000000000';
// Tables that carry a project-like scope_id today.
const SCOPE_SOURCES = [
  'workflows',
  'chat_sessions',
  'scheduled_jobs',
  'automation_hooks',
  'heartbeat_profiles',
  'standing_orders',
  'workflow_run_todos',
  'notifications',
];

export class BackfillScopeNodes20260609010000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Insert each distinct scope_id as a leaf project node under the global root.
    for (const table of SCOPE_SOURCES) {
      const exists = (await queryRunner.query(`SELECT to_regclass($1) AS t`, [
        table,
      ])) as Array<{ t: string | null }>;
      if (!exists[0]?.t) continue;
      await queryRunner.query(
        `INSERT INTO scope_nodes (id, parent_id, type, name, slug)
         SELECT DISTINCT s.scope_id, $1::uuid, 'project',
                'project-' || left(s.scope_id::text, 8),
                left(s.scope_id::text, 8)
         FROM ${table} s
         WHERE s.scope_id IS NOT NULL
         ON CONFLICT (id) DO NOTHING`,
        [ROOT],
      );
    }

    // Self-closure rows for all new leaf nodes (depth 0).
    await queryRunner.query(
      `INSERT INTO scope_node_closure (ancestor_id, descendant_id, depth)
       SELECT id, id, 0 FROM scope_nodes WHERE id <> $1::uuid
       ON CONFLICT DO NOTHING`,
      [ROOT],
    );
    // Root → leaf closure rows (depth 1).
    await queryRunner.query(
      `INSERT INTO scope_node_closure (ancestor_id, descendant_id, depth)
       SELECT $1::uuid, id, 1 FROM scope_nodes WHERE id <> $1::uuid AND parent_id = $1::uuid
       ON CONFLICT DO NOTHING`,
      [ROOT],
    );
  }

  public async down(): Promise<void> {
    // Non-destructive: leaf nodes removed only via the create-hierarchy down() guard path.
  }
}
