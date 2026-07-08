import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePluginEventDeliveries20260518120000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS plugin_event_deliveries (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        plugin_id character varying(255) NOT NULL,
        plugin_version character varying(64) NOT NULL,
        contribution_id character varying(255) NOT NULL,
        topic character varying(255) NOT NULL,
        event_name character varying(255) NOT NULL,
        payload jsonb NOT NULL,
        correlation_id character varying(255),
        delivery_mode character varying(32) NOT NULL,
        status character varying(32) NOT NULL,
        attempt_count integer NOT NULL DEFAULT 0,
        max_attempts integer NOT NULL DEFAULT 3,
        retry_initial_delay_ms integer NOT NULL DEFAULT 1000,
        retry_backoff_multiplier double precision NOT NULL DEFAULT 2,
        dead_letter_enabled boolean NOT NULL DEFAULT true,
        next_attempt_at timestamptz NOT NULL,
        delivered_at timestamptz,
        error_code character varying(255),
        error_message text,
        error_metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT NOW(),
        updated_at timestamptz NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_plugin_event_deliveries_status
          CHECK (status IN ('pending', 'delivering', 'delivered', 'failed', 'dead_lettered')),
        CONSTRAINT chk_plugin_event_deliveries_delivery_mode
          CHECK (delivery_mode IN ('blocking', 'non_blocking'))
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_event_deliveries_status
      ON plugin_event_deliveries(status);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_event_deliveries_next_attempt_at
      ON plugin_event_deliveries(next_attempt_at);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_event_deliveries_plugin_id
      ON plugin_event_deliveries(plugin_id);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_event_deliveries_topic
      ON plugin_event_deliveries(topic);
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_plugin_event_deliveries_contribution_id
      ON plugin_event_deliveries(contribution_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS plugin_event_deliveries');
  }
}
