import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shadow-phase backfill: copies the satellite-owned fields of every existing
 * `subagent_executions` row into the `subagent_details` satellite. Column types
 * already match the legacy table, so the copy is cast-free. Rows that the
 * dual-write has already mirrored are skipped via ON CONFLICT DO NOTHING.
 */
export class BackfillSubagentDetails20260614200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO subagent_details (
        execution_id,
        parent_container_id,
        delegation_contract_id,
        lineage_trace_id,
        lineage_parent_trace_id,
        depth,
        assigned_files,
        parent_session_tree_id,
        result,
        created_at,
        updated_at
      )
      SELECT
        id,
        parent_container_id,
        delegation_contract_id,
        lineage_trace_id,
        lineage_parent_trace_id,
        depth,
        assigned_files,
        parent_session_tree_id,
        result,
        created_at,
        COALESCE(completed_at, created_at)
      FROM subagent_executions
      ON CONFLICT (execution_id) DO NOTHING;
    `);
  }

  public async down(): Promise<void> {
    // No-op: the backfilled satellite rows are fully reconstructable from
    // subagent_executions, so this migration intentionally does not delete them.
  }
}
