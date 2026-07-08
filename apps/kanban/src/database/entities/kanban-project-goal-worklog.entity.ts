import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_project_goal_worklogs")
@Index("idx_kanban_project_goal_worklogs_goal_id", ["goal_id"])
@Index("idx_kanban_project_goal_worklogs_project_id", ["project_id"])
export class KanbanProjectGoalWorklogEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  goal_id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "uuid", nullable: true })
  work_item_id!: string | null;

  @Column({ type: "varchar", length: 32, default: "note" })
  entry_type!: string;

  @Column({ type: "varchar", length: 32, default: "user" })
  author_type!: string;

  @Column({ type: "varchar", nullable: true })
  author_id!: string | null;

  @Column({ type: "varchar", nullable: true })
  author_name!: string | null;

  @Column({ type: "text" })
  note!: string;

  @Column({ type: "varchar", nullable: true })
  linked_run_id!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
