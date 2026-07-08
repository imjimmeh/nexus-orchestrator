import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration: Migrate legacy kanban data from API tables to kanban tables.
 *
 * This migration runs after the kanban source-of-truth migration has created
 * the new kanban_* tables. It ports data from the old tables (projects,
 * work_items, etc.) that are about to be dropped by the API scorched-earth
 * cleanup migration.
 *
 * The migration is idempotent: it skips rows that already exist in the
 * target tables by primary key.
 */
export class MigrateLegacyKanbanData20260502130000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.migrateProjects(queryRunner);
    await this.migrateWorkItems(queryRunner);
    await this.migrateWorkItemDependencies(queryRunner);
    await this.migrateWorkItemSubtasks(queryRunner);
    await this.migrateProjectGoals(queryRunner);
    await this.migrateProjectGoalWorklogs(queryRunner);
    await this.migrateProjectOrchestrations(queryRunner);
    await this.migrateProjectAgentCapacities(queryRunner);
    await this.migrateProjectMembers(queryRunner);
  }

  private async migrateProjects(queryRunner: QueryRunner): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("projects");
    const hasNewTable = await queryRunner.hasTable("kanban_projects");
    if (!hasOldTable || !hasNewTable) return;

    await queryRunner.query(`
      INSERT INTO kanban_projects (
        id, name, goals, repository_url, base_path, github_secret_id,
        description, source_type, copy_to_workspace,
        allow_host_mounts, deny_host_mounts, allow_host_mount_rw,
        created_at, updated_at
      )
      SELECT
        id, name, NULL, repository_url, base_path, github_secret_id,
        description, source_type, copy_to_workspace,
        allow_host_mounts, deny_host_mounts, allow_host_mount_rw,
        created_at, updated_at
      FROM projects
      WHERE NOT EXISTS (
        SELECT 1 FROM kanban_projects kp WHERE kp.id = projects.id
      )
    `);
  }

  private async migrateWorkItems(queryRunner: QueryRunner): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("work_items");
    const hasNewTable = await queryRunner.hasTable("kanban_work_items");
    if (!hasOldTable || !hasNewTable) return;

    // Migrate core columns. Discovery columns (provenance, evidence_refs,
    // discovery_confidence, source_id, source_path, source_hash,
    // source_last_synced_at) are folded into metadata since the kanban
    // schema intentionally omits them.
    await queryRunner.query(`
      INSERT INTO kanban_work_items (
        id, project_id, title, description, status, priority, scope,
        assigned_agent_id, token_spend, current_execution_id,
        waiting_for_input, execution_config, metadata, linked_run_id,
        created_at, updated_at
      )
      SELECT
        id, project_id, title, description, status, priority, scope,
        assigned_agent_id, token_spend, current_execution_id,
        waiting_for_input, execution_config,
        COALESCE(
          metadata || jsonb_build_object(
            '_legacy_provenance', provenance,
            '_legacy_evidence_refs', evidence_refs,
            '_legacy_discovery_confidence', discovery_confidence,
            '_legacy_source_id', source_id,
            '_legacy_source_path', source_path,
            '_legacy_source_hash', source_hash,
            '_legacy_source_last_synced_at', source_last_synced_at
          ),
          jsonb_build_object(
            '_legacy_provenance', provenance,
            '_legacy_evidence_refs', evidence_refs,
            '_legacy_discovery_confidence', discovery_confidence,
            '_legacy_source_id', source_id,
            '_legacy_source_path', source_path,
            '_legacy_source_hash', source_hash,
            '_legacy_source_last_synced_at', source_last_synced_at
          )
        ),
        NULL,
        created_at, updated_at
      FROM work_items
      WHERE NOT EXISTS (
        SELECT 1 FROM kanban_work_items kw WHERE kw.id = work_items.id
      )
    `);
  }

  private async migrateWorkItemDependencies(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("work_item_dependencies");
    const hasNewTable = await queryRunner.hasTable(
      "kanban_work_item_dependencies",
    );
    if (!hasOldTable || !hasNewTable) return;

    await queryRunner.query(`
      INSERT INTO kanban_work_item_dependencies (id, work_item_id, depends_on_work_item_id)
      SELECT id, work_item_id, depends_on_work_item_id
      FROM work_item_dependencies
      WHERE NOT EXISTS (
        SELECT 1 FROM kanban_work_item_dependencies kd
        WHERE kd.id = work_item_dependencies.id
      )
    `);
  }

  private async migrateWorkItemSubtasks(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("work_item_subtasks");
    const hasNewTable = await queryRunner.hasTable("kanban_work_item_subtasks");
    if (!hasOldTable || !hasNewTable) return;

    await queryRunner.query(`
      INSERT INTO kanban_work_item_subtasks (
        id, project_id, work_item_id, subtask_id, title, status,
        order_index, depends_on_subtask_ids, source_path, source_hash,
        source_last_synced_at, is_archived, metadata, created_at, updated_at
      )
      SELECT
        id, project_id::uuid, work_item_id::uuid, subtask_id, title, status,
        order_index, depends_on_subtask_ids, source_path, source_hash,
        source_last_synced_at, is_archived, metadata, created_at, updated_at
      FROM work_item_subtasks
      WHERE NOT EXISTS (
        SELECT 1 FROM kanban_work_item_subtasks ks WHERE ks.id = work_item_subtasks.id
      )
    `);
  }

  private async migrateProjectGoals(queryRunner: QueryRunner): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("project_goals");
    const hasNewTable = await queryRunner.hasTable("kanban_project_goals");
    if (!hasOldTable || !hasNewTable) return;

    await queryRunner.query(`
      INSERT INTO kanban_project_goals (
        id, project_id, title, description, status, moscow, priority,
        sort_order, target_date, completed_at, owner_agent_profile_id,
        metadata, is_archived, created_at, updated_at
      )
      SELECT
        id, project_id, title, description, status, moscow, priority,
        sort_order, target_date, completed_at, owner_agent_profile_id,
        metadata, is_archived, created_at, updated_at
      FROM project_goals
      WHERE NOT EXISTS (
        SELECT 1 FROM kanban_project_goals kg WHERE kg.id = project_goals.id
      )
    `);
  }

  private async migrateProjectGoalWorklogs(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("project_goal_worklogs");
    const hasNewTable = await queryRunner.hasTable(
      "kanban_project_goal_worklogs",
    );
    if (!hasOldTable || !hasNewTable) return;

    await queryRunner.query(`
      INSERT INTO kanban_project_goal_worklogs (
        id, goal_id, project_id, work_item_id, entry_type, author_type,
        author_id, author_name, note, linked_run_id, metadata,
        created_at, updated_at
      )
      SELECT
        id, goal_id, project_id, work_item_id, entry_type, author_type,
        author_id, author_name, note, linked_run_id, metadata,
        created_at, updated_at
      FROM project_goal_worklogs
      WHERE NOT EXISTS (
        SELECT 1 FROM kanban_project_goal_worklogs kgl WHERE kgl.id = project_goal_worklogs.id
      )
    `);
  }

  private async migrateProjectOrchestrations(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("project_orchestrations");
    const hasNewTable = await queryRunner.hasTable("kanban_orchestrations");
    if (!hasOldTable || !hasNewTable) return;

    // Migrate the orchestration row itself
    await queryRunner.query(`
      INSERT INTO kanban_orchestrations (
        project_id, goals, mode, status, linked_run_id,
        decision_log, action_requests, metadata, created_at, updated_at
      )
      SELECT
        project_id,
        COALESCE(goals, ''),
        COALESCE(orchestration_mode, 'supervised'),
        COALESCE(status, 'idle'),
        current_workflow_run_id,
        COALESCE(decision_log, '[]'),
        '[]',
        metadata,
        created_at, updated_at
      FROM project_orchestrations
      WHERE NOT EXISTS (
        SELECT 1 FROM kanban_orchestrations ko WHERE ko.project_id = project_orchestrations.project_id
      )
    `);

    // Migrate action_requests from the relational table into the JSONB array
    const hasActionRequestsTable = await queryRunner.hasTable(
      "project_orchestration_action_requests",
    );
    if (!hasActionRequestsTable) return;

    await queryRunner.query(`
      UPDATE kanban_orchestrations ko
      SET action_requests = COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', ar.id,
              'project_id', ar.project_id,
              'action', ar.action,
              'payload', ar.payload,
              'workflowRunId', ar.workflow_run_id,
              'modeAtRequest', ar.mode_at_request,
              'requestedBy', ar.requested_by,
              'status', ar.status,
              'approvedBy', ar.approved_by,
              'approvedAt', ar.approved_at,
              'rejectedBy', ar.rejected_by,
              'rejectedAt', ar.rejected_at,
              'rejectionReason', ar.rejection_reason,
              'executedAt', ar.executed_at,
              'errorMessage', ar.error_message,
              'correlationId', ar.correlation_id,
              'created_at', ar.created_at,
              'updated_at', ar.updated_at
            )
            ORDER BY ar.created_at
          )
          FROM project_orchestration_action_requests ar
          WHERE ar.project_id = ko.project_id
        ),
        '[]'
      )
      WHERE ko.action_requests = '[]'
    `);
  }

  private async migrateProjectAgentCapacities(
    queryRunner: QueryRunner,
  ): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("project_agent_capacities");
    const hasNewTable = await queryRunner.hasTable("kanban_projects");
    const hasMetadataColumn = await queryRunner.hasColumn(
      "kanban_projects",
      "metadata",
    );
    if (!hasOldTable || !hasNewTable || !hasMetadataColumn) return;

    // The kanban schema intentionally does not have a project_agent_capacities
    // table; capacities are now handled at dispatch time via
    // maxConcurrentPerAgent.  We fold the old capacity data into the project
    // metadata so it is not lost during cutover.
    await queryRunner.query(`
      UPDATE kanban_projects kp
      SET metadata = COALESCE(
        metadata || jsonb_build_object(
          '_legacy_agent_capacities',
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'agent_profile_id', pac.agent_profile_id,
                'max_active_items', pac.max_active_items,
                'is_enabled', pac.is_enabled
              )
            )
            FROM project_agent_capacities pac
            WHERE pac.project_id = kp.id
          )
        ),
        jsonb_build_object(
          '_legacy_agent_capacities',
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'agent_profile_id', pac.agent_profile_id,
                'max_active_items', pac.max_active_items,
                'is_enabled', pac.is_enabled
              )
            )
            FROM project_agent_capacities pac
            WHERE pac.project_id = kp.id
          )
        )
      )
      WHERE EXISTS (
        SELECT 1 FROM project_agent_capacities pac2 WHERE pac2.project_id = kp.id
      )
      AND (
        metadata IS NULL
        OR NOT (metadata ? '_legacy_agent_capacities')
      )
    `);
  }

  private async migrateProjectMembers(queryRunner: QueryRunner): Promise<void> {
    const hasOldTable = await queryRunner.hasTable("project_members");
    const hasNewTable = await queryRunner.hasTable("kanban_projects");
    const hasMetadataColumn = await queryRunner.hasColumn(
      "kanban_projects",
      "metadata",
    );
    if (!hasOldTable || !hasNewTable || !hasMetadataColumn) return;

    // The kanban schema intentionally does not have a project_members table.
    // Fold the membership data into project metadata so it is not lost.
    await queryRunner.query(`
      UPDATE kanban_projects kp
      SET metadata = COALESCE(
        metadata || jsonb_build_object(
          '_legacy_members',
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'user_id', pm.user_id,
                'role', pm.role
              )
            )
            FROM project_members pm
            WHERE pm.project_id = kp.id
          )
        ),
        jsonb_build_object(
          '_legacy_members',
          (
            SELECT jsonb_agg(
              jsonb_build_object(
                'user_id', pm.user_id,
                'role', pm.role
              )
            )
            FROM project_members pm
            WHERE pm.project_id = kp.id
          )
        )
      )
      WHERE EXISTS (
        SELECT 1 FROM project_members pm2 WHERE pm2.project_id = kp.id
      )
      AND (
        metadata IS NULL
        OR NOT (metadata ? '_legacy_members')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Truncate the migrated data.  We cannot restore the old tables here
    // because the scorched-earth migration drops them; this down() simply
    // empties the kanban tables so the migration can be re-run cleanly.
    await queryRunner.query(
      "TRUNCATE TABLE kanban_project_goal_worklogs CASCADE",
    );
    await queryRunner.query("TRUNCATE TABLE kanban_project_goals CASCADE");
    await queryRunner.query("TRUNCATE TABLE kanban_orchestrations CASCADE");
    await queryRunner.query("TRUNCATE TABLE kanban_work_item_subtasks CASCADE");
    await queryRunner.query(
      "TRUNCATE TABLE kanban_work_item_dependencies CASCADE",
    );
    await queryRunner.query("TRUNCATE TABLE kanban_work_items CASCADE");
    await queryRunner.query("TRUNCATE TABLE kanban_projects CASCADE");
  }
}
