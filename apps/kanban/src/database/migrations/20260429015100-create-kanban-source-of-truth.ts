import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanSourceOfTruth20260429015100 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createProjectAndWorkItemTables(queryRunner);
    await this.createGoalAndOrchestrationTables(queryRunner);
    await this.createCoreLifecycleTables(queryRunner);
  }

  private async createProjectAndWorkItemTables(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying(255) NOT NULL,
        goals text,
        repository_url character varying,
        base_path character varying,
        github_secret_id character varying,
        description text,
        source_type character varying,
        copy_to_workspace boolean,
        allow_host_mounts text,
        deny_host_mounts text,
        allow_host_mount_rw text,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_work_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        title character varying(255) NOT NULL,
        description text,
        status character varying(64) NOT NULL DEFAULT 'todo',
        priority character varying(32) NOT NULL DEFAULT 'p2',
        scope character varying(10) NOT NULL DEFAULT 'standard',
        assigned_agent_id character varying,
        token_spend integer NOT NULL DEFAULT 0,
        current_execution_id character varying,
        waiting_for_input boolean NOT NULL DEFAULT false,
        execution_config jsonb,
        metadata jsonb,
        linked_run_id character varying,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_kanban_work_items_project_id ON kanban_work_items(project_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_work_item_dependencies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        work_item_id UUID NOT NULL,
        depends_on_work_item_id UUID NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_work_item_dependencies_pair ON kanban_work_item_dependencies(work_item_id, depends_on_work_item_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_kanban_work_item_dependencies_depends_on ON kanban_work_item_dependencies(depends_on_work_item_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_work_item_subtasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        work_item_id UUID NOT NULL,
        subtask_id character varying(255) NOT NULL,
        title character varying(500) NOT NULL,
        status character varying(32) NOT NULL DEFAULT 'todo',
        order_index integer NOT NULL DEFAULT 0,
        depends_on_subtask_ids jsonb,
        source_path text NOT NULL,
        source_hash character varying(64) NOT NULL,
        source_last_synced_at TIMESTAMP,
        is_archived boolean NOT NULL DEFAULT false,
        metadata jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_kanban_work_item_subtasks_work_item_subtask ON kanban_work_item_subtasks(work_item_id, subtask_id)`,
    );
  }

  private async createGoalAndOrchestrationTables(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_project_goals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        title character varying(255) NOT NULL,
        description text,
        status character varying(32) NOT NULL DEFAULT 'todo',
        moscow character varying(16),
        priority character varying(16),
        sort_order integer NOT NULL DEFAULT 0,
        target_date date,
        completed_at TIMESTAMP,
        owner_agent_profile_id UUID,
        metadata jsonb,
        is_archived boolean NOT NULL DEFAULT false,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_kanban_project_goals_project_id ON kanban_project_goals(project_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_project_goal_worklogs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        goal_id UUID NOT NULL,
        project_id UUID NOT NULL,
        work_item_id UUID,
        entry_type character varying(32) NOT NULL DEFAULT 'note',
        author_type character varying(32) NOT NULL DEFAULT 'user',
        author_id character varying,
        author_name character varying,
        note text NOT NULL,
        linked_run_id character varying,
        metadata jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_orchestrations (
        project_id UUID PRIMARY KEY,
        goals text NOT NULL,
        mode character varying(32) NOT NULL,
        status character varying(32) NOT NULL,
        linked_run_id character varying,
        decision_log jsonb,
        action_requests jsonb,
        metadata jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  private async createCoreLifecycleTables(
    queryRunner: QueryRunner,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_core_run_projections (
        run_id character varying(255) PRIMARY KEY,
        workflow_id character varying(255) NOT NULL,
        status character varying(128) NOT NULL,
        project_id character varying(255),
        work_item_id character varying(255),
        occurred_at TIMESTAMP NOT NULL,
        last_event_id character varying(255) NOT NULL,
        last_event_type character varying(255) NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_kanban_core_run_projections_project_id ON kanban_core_run_projections(project_id)`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_core_lifecycle_cursors (
        consumer_name character varying(128) PRIMARY KEY,
        stream_key character varying(255) NOT NULL,
        stream_id character varying(64) NOT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_core_lifecycle_dead_letters (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        stream_key character varying(255) NOT NULL,
        stream_id character varying(64) NOT NULL,
        reason text NOT NULL,
        payload jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_kanban_core_lifecycle_dead_letters_stream_id ON kanban_core_lifecycle_dead_letters(stream_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_core_lifecycle_dead_letters",
    );
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_core_lifecycle_cursors",
    );
    await queryRunner.query("DROP TABLE IF EXISTS kanban_core_run_projections");
    await queryRunner.query("DROP TABLE IF EXISTS kanban_orchestrations");
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_project_goal_worklogs",
    );
    await queryRunner.query("DROP TABLE IF EXISTS kanban_project_goals");
    await queryRunner.query("DROP TABLE IF EXISTS kanban_work_item_subtasks");
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_work_item_dependencies",
    );
    await queryRunner.query("DROP TABLE IF EXISTS kanban_work_items");
    await queryRunner.query("DROP TABLE IF EXISTS kanban_projects");
  }
}
