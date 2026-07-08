import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubagentDetails20260614190000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS subagent_details (
        execution_id UUID PRIMARY KEY,
        parent_container_id character varying(255) NOT NULL,
        delegation_contract_id UUID,
        lineage_trace_id character varying(255),
        lineage_parent_trace_id character varying(255),
        depth integer NOT NULL DEFAULT 0,
        assigned_files jsonb,
        parent_session_tree_id character varying(255),
        result jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_subagent_details_parent_container
      ON subagent_details(parent_container_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS subagent_details');
  }
}
