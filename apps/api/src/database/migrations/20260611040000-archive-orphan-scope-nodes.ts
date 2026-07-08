import { MigrationInterface, QueryRunner } from 'typeorm';

const ROOT = '00000000-0000-0000-0000-000000000000';

export class ArchiveOrphanScopeNodes20260611040000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE scope_nodes
       SET archived_at = now()
       WHERE type = 'project'
         AND id <> $1::uuid
         AND archived_at IS NULL
         AND id NOT IN (
           SELECT scope_id FROM workflows           WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM chat_sessions        WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM scheduled_jobs       WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM automation_hooks     WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM heartbeat_profiles   WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM standing_orders      WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM workflow_run_todos   WHERE scope_id IS NOT NULL UNION
           SELECT scope_id FROM notifications        WHERE scope_id IS NOT NULL
         )`,
      [ROOT],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE scope_nodes SET archived_at = NULL WHERE type = 'project'`,
    );
  }
}
