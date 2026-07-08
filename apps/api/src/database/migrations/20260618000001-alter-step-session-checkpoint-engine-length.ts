import { MigrationInterface, QueryRunner } from 'typeorm';

export class AlterStepSessionCheckpointEngineLength20260618000001 implements MigrationInterface {
  name = 'AlterStepSessionCheckpointEngineLength20260618000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "step_session_checkpoint" ALTER COLUMN "engine" TYPE varchar(64)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "step_session_checkpoint" ALTER COLUMN "engine" TYPE varchar(16)`,
    );
  }
}
