import { MigrationInterface, QueryRunner } from 'typeorm';

export class DedupToolRegistryNames20260712000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM tool_registry
       WHERE id IN (
         SELECT id FROM (
           SELECT
             id,
             ROW_NUMBER() OVER (
               PARTITION BY name
               ORDER BY updated_at DESC, created_at DESC, id DESC
             ) AS rn
           FROM tool_registry
         ) ranked
         WHERE ranked.rn > 1
       )`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // No-op: deleted duplicate rows cannot be restored.
  }
}
