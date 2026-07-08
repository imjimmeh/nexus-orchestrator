import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_work_items")
@Index("idx_kanban_work_items_project_id", ["project_id"])
export class KanbanWorkItemEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 64 })
  status!: string;

  @Column({ type: "varchar", length: 32, default: "p2" })
  priority!: string;

  @Column({ type: "varchar", length: 16, default: "story" })
  type!: string;

  @Column({ name: "parent_work_item_id", type: "uuid", nullable: true })
  @Index("idx_kanban_work_items_parent")
  parent_work_item_id!: string | null;

  @Column({ name: "story_points", type: "smallint", nullable: true })
  story_points!: number | null;

  @Column({ name: "assigned_agent_id", type: "varchar", nullable: true })
  assigned_agent_id!: string | null;

  @Column({ name: "token_spend", type: "integer", default: 0 })
  token_spend!: number;

  @Column({ name: "cost_cents", type: "integer", default: 0 })
  cost_cents!: number;

  @Column({ name: "current_execution_id", type: "varchar", nullable: true })
  current_execution_id!: string | null;

  @Column({ name: "waiting_for_input", type: "boolean", default: false })
  waiting_for_input!: boolean;

  @Column({ name: "execution_config", type: "jsonb", nullable: true })
  execution_config!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: "varchar", nullable: true })
  linked_run_id!: string | null;

  @Column({ name: "last_execution_status", type: "varchar", nullable: true })
  last_execution_status!: string | null;

  @Column({ type: "uuid", nullable: true })
  initiative_id!: string | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
