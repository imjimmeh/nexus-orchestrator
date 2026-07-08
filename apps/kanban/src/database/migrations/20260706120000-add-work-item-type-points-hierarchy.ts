import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddWorkItemTypePointsHierarchy20260706120000 implements MigrationInterface {
  name = "AddWorkItemTypePointsHierarchy20260706120000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kanban_work_items
        ADD COLUMN IF NOT EXISTS type varchar(16) NOT NULL DEFAULT 'story',
        ADD COLUMN IF NOT EXISTS parent_work_item_id uuid NULL
          REFERENCES kanban_work_items(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS story_points smallint NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_kanban_work_items_parent
        ON kanban_work_items(parent_work_item_id)
    `);

    // Preserve existing split hierarchies: children referenced by a parent's
    // metadata.split.proposedChildIds become type=task parented to that item.
    await queryRunner.query(`
      UPDATE kanban_work_items child
      SET type = 'task',
          parent_work_item_id = parent.id
      FROM kanban_work_items parent
      WHERE parent.metadata -> 'split' -> 'proposedChildIds' ? child.id::text
    `);

    await queryRunner.query(
      `ALTER TABLE kanban_work_items DROP COLUMN IF EXISTS scope`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE kanban_work_items
        ADD COLUMN IF NOT EXISTS scope varchar(10) NOT NULL DEFAULT 'standard'
    `);
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_kanban_work_items_parent`,
    );
    await queryRunner.query(`
      ALTER TABLE kanban_work_items
        DROP COLUMN IF EXISTS story_points,
        DROP COLUMN IF EXISTS parent_work_item_id,
        DROP COLUMN IF EXISTS type
    `);
  }
}
