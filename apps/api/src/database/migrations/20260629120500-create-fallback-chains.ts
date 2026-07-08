import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFallbackChains20260629120500 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS fallback_chains (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name character varying(128) NOT NULL,
        entries jsonb NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_fallback_chains_name
      ON fallback_chains(name);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS fallback_chains');
  }
}
