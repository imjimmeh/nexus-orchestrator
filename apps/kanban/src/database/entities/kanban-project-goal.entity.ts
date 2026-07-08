import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_project_goals")
@Index("idx_kanban_project_goals_project_id", ["project_id"])
export class KanbanProjectGoalEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 32, default: "todo" })
  status!: string;

  @Column({ type: "varchar", length: 16, nullable: true })
  moscow!: string | null;

  @Column({ type: "varchar", length: 16, nullable: true })
  priority!: string | null;

  @Column({ type: "integer", default: 0 })
  sort_order!: number;

  @Column({ type: "date", nullable: true })
  target_date!: string | null;

  @Column({ type: "timestamp", nullable: true })
  completed_at!: Date | null;

  @Column({ type: "uuid", nullable: true })
  owner_agent_profile_id!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: "boolean", default: false })
  is_archived!: boolean;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
