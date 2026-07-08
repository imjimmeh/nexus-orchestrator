import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddThinkingLevelColumns20260709000000 implements MigrationInterface {
  name = 'AddThinkingLevelColumns20260709000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "llm_models" ADD COLUMN IF NOT EXISTS "default_thinking_level" varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE "agent_profiles" ADD COLUMN IF NOT EXISTS "thinking_level" varchar`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "agent_profiles" DROP COLUMN IF EXISTS "thinking_level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "llm_models" DROP COLUMN IF EXISTS "default_thinking_level"`,
    );
  }
}
