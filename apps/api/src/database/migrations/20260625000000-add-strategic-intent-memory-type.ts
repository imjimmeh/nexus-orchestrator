import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * EPIC-208 (Milestone 1) — CEO-Driven Strategic Refresh Loop.
 *
 * Adds the `strategic_intent` value to the
 * `memory_segments_memory_type_enum` PostgreSQL enum so the TypeScript
 * `IMemorySegment.memory_type` union can persist CEO long-term planning
 * intent (horizon, priority_themes, focus_areas, constraints) as a
 * first-class memory segment type.
 *
 * PostgreSQL forbids `ALTER TYPE ... ADD VALUE` inside a transaction
 * block, so the migration is explicitly marked `transaction: false` to
 * opt out of the implicit transaction TypeORM wraps around `up()`/
 * `down()`.
 */
export class AddStrategicIntentMemoryType20260625000000 implements MigrationInterface {
  public readonly transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "public"."memory_segments_memory_type_enum"
        ADD VALUE IF NOT EXISTS 'strategic_intent';
    `);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing an enum value once it has
    // been added. The down migration is intentionally a no-op; the value
    // is left in place and operators can rebuild the enum type if a true
    // rollback is required.
  }
}
