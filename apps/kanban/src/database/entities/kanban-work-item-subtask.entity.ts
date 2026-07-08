import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_work_item_subtasks")
@Index("idx_kanban_work_item_subtasks_project_id", ["project_id"])
@Index("idx_kanban_work_item_subtasks_work_item_id", ["work_item_id"])
@Index(
  "uq_kanban_work_item_subtasks_work_item_subtask",
  ["work_item_id", "subtask_id"],
  { unique: true },
)
export class KanbanWorkItemSubtaskEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "uuid" })
  work_item_id!: string;

  @Column({ type: "varchar", length: 255 })
  subtask_id!: string;

  @Column({ type: "varchar", length: 500 })
  title!: string;

  @Column({ type: "varchar", length: 32, default: "todo" })
  status!: string;

  @Column({ type: "integer", default: 0 })
  order_index!: number;

  @Column({ type: "jsonb", nullable: true })
  depends_on_subtask_ids!: string[] | null;

  @Column({ type: "text" })
  source_path!: string;

  @Column({ type: "varchar", length: 64 })
  source_hash!: string;

  @Column({ type: "timestamp", nullable: true })
  source_last_synced_at!: Date | null;

  @Column({ type: "boolean", default: false })
  is_archived!: boolean;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
