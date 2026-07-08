import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCostGovernanceTables20260604130000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS budget_policies (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        name character varying(255) NOT NULL,
        scope_type character varying(64) NOT NULL,
        scope_id character varying,
        context_type character varying(64),
        context_id character varying,
        provider_name character varying,
        model_name character varying,
        soft_limit_cents integer,
        hard_limit_cents integer,
        token_limit integer,
        "window" character varying(32) NOT NULL,
        enforcement_mode character varying(32) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS budget_decision_events (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        correlation_id character varying,
        policy_id uuid,
        scope_id character varying,
        context_type character varying(64) NOT NULL,
        context_id character varying NOT NULL,
        action_type character varying(64) NOT NULL,
        decision character varying(32) NOT NULL,
        reason_code character varying(64) NOT NULL,
        estimated_cost_cents integer,
        remaining_budget_cents integer,
        approval_request_id uuid,
        metadata jsonb,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS budget_usage_events (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        correlation_id character varying,
        scope_id character varying,
        context_type character varying(64) NOT NULL,
        context_id character varying NOT NULL,
        actor_type character varying(64) NOT NULL,
        actor_id character varying,
        provider_name character varying,
        model_name character varying,
        input_tokens integer,
        output_tokens integer,
        total_tokens integer,
        estimated_cost_cents integer,
        estimate_source character varying(64) NOT NULL,
        metadata jsonb,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_policies_scope
      ON budget_policies(scope_type, scope_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_policies_context
      ON budget_policies(context_type, context_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_policies_is_active
      ON budget_policies(is_active);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_decision_events_correlation_id
      ON budget_decision_events(correlation_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_decision_events_scope_id
      ON budget_decision_events(scope_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_decision_events_context
      ON budget_decision_events(context_type, context_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_decision_events_created_at
      ON budget_decision_events(created_at);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_usage_events_scope_id
      ON budget_usage_events(scope_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_usage_events_context
      ON budget_usage_events(context_type, context_id);
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_budget_usage_events_created_at
      ON budget_usage_events(created_at);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS budget_usage_events;');
    await queryRunner.query('DROP TABLE IF EXISTS budget_decision_events;');
    await queryRunner.query('DROP TABLE IF EXISTS budget_policies;');
  }
}
