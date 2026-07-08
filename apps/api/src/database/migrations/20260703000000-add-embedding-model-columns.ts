import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmbeddingModelColumns20260703000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE llm_models
        ADD COLUMN IF NOT EXISTS supports_embedding boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS embedding_dimension int NULL,
        ADD COLUMN IF NOT EXISTS default_for_embedding boolean NOT NULL DEFAULT false;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE llm_models
        DROP COLUMN IF EXISTS supports_embedding,
        DROP COLUMN IF EXISTS embedding_dimension,
        DROP COLUMN IF EXISTS default_for_embedding;
    `);
  }
}
