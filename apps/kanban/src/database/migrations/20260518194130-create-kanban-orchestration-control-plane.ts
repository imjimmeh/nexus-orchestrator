import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateKanbanOrchestrationControlPlane20260518194130 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.createTables(queryRunner);
    await this.createIndexes(queryRunner);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_orchestration_launch_attempts",
    );
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_orchestration_scheduler_outcomes",
    );
    await queryRunner.query("DROP TABLE IF EXISTS kanban_orchestration_facts");
    await queryRunner.query(
      "DROP TABLE IF EXISTS kanban_orchestration_intents",
    );
  }

  private async createTables(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_orchestration_intents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        lane character varying(64) NOT NULL,
        type character varying(96) NOT NULL,
        status character varying(32) NOT NULL,
        requester character varying(128) NOT NULL,
        reason text NOT NULL,
        priority integer NOT NULL DEFAULT 0,
        evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        resource_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
        conflict_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
        workflow_id character varying(255),
        workflow_scope character varying(255),
        idempotency_key character varying(255) NOT NULL,
        supersedes_intent_id UUID,
        freshness_requirements jsonb NOT NULL DEFAULT '{}'::jsonb,
        terminal_outcome character varying(96),
        metadata jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_orchestration_facts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        fact_type character varying(128) NOT NULL,
        subject_kind character varying(64) NOT NULL,
        subject_id character varying(255) NOT NULL,
        source_type character varying(64) NOT NULL,
        source_id character varying(255) NOT NULL,
        confidence double precision NOT NULL,
        freshness_status character varying(32) NOT NULL,
        observed_at TIMESTAMP NOT NULL,
        expires_at TIMESTAMP,
        invalidated_at TIMESTAMP,
        invalidated_by_event_id character varying(255),
        payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
        evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
        metadata jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_orchestration_scheduler_outcomes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        intent_id UUID NOT NULL REFERENCES kanban_orchestration_intents(id) ON DELETE CASCADE,
        project_id UUID NOT NULL,
        status character varying(32) NOT NULL,
        reason character varying(96) NOT NULL,
        conflict_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
        active_conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
        evaluated_at TIMESTAMP NOT NULL,
        policy_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_orchestration_launch_attempts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        intent_id UUID NOT NULL REFERENCES kanban_orchestration_intents(id) ON DELETE CASCADE,
        outcome_id UUID REFERENCES kanban_orchestration_scheduler_outcomes(id) ON DELETE SET NULL,
        project_id UUID NOT NULL,
        workflow_id character varying(255) NOT NULL,
        workflow_scope character varying(255),
        workflow_run_id character varying(255),
        idempotency_key character varying(255) NOT NULL,
        status character varying(32) NOT NULL,
        failure_reason text,
        requested_at TIMESTAMP NOT NULL,
        completed_at TIMESTAMP,
        response_payload jsonb,
        metadata jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
  }

  private async createIndexes(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanban_orchestration_intents_idempotency_key
      ON kanban_orchestration_intents(idempotency_key)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_intents_project_lane_status
      ON kanban_orchestration_intents(project_id, lane, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_intents_conflict_keys
      ON kanban_orchestration_intents USING GIN(conflict_keys)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_facts_project_subject
      ON kanban_orchestration_facts(project_id, subject_kind, subject_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_facts_project_type_freshness
      ON kanban_orchestration_facts(project_id, fact_type, freshness_status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_facts_expires_at
      ON kanban_orchestration_facts(expires_at)
      WHERE expires_at IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_scheduler_outcomes_intent_created
      ON kanban_orchestration_scheduler_outcomes(intent_id, created_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_scheduler_outcomes_project_status
      ON kanban_orchestration_scheduler_outcomes(project_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_launch_attempts_intent
      ON kanban_orchestration_launch_attempts(intent_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_launch_attempts_project_created
      ON kanban_orchestration_launch_attempts(project_id, created_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_orchestration_launch_attempts_workflow_run
      ON kanban_orchestration_launch_attempts(workflow_run_id)
      WHERE workflow_run_id IS NOT NULL
    `);
  }
}
