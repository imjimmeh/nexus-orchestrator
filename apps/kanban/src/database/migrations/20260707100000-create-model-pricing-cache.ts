import type { MigrationInterface, QueryRunner } from "typeorm";

export class CreateModelPricingCache20260707100000 implements MigrationInterface {
  name = "CreateModelPricingCache20260707100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS kanban_model_pricing_cache (
        model_id character varying PRIMARY KEY,
        provider_name character varying NULL,
        model_name character varying NOT NULL,
        input_token_cents_per_million integer NULL,
        output_token_cents_per_million integer NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        synced_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE IF EXISTS kanban_model_pricing_cache");
  }
}
