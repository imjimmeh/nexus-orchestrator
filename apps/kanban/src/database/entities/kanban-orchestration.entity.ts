import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_orchestrations")
export class KanbanOrchestrationEntity {
  @PrimaryColumn("uuid")
  project_id!: string;

  @Column({ type: "text" })
  goals!: string;

  @Column({ type: "varchar", length: 32 })
  mode!: string;

  @Column({ type: "varchar", length: 32 })
  status!: string;

  @Column({ type: "varchar", nullable: true })
  linked_run_id!: string | null;

  @Column({ type: "jsonb", nullable: true })
  decision_log!: Record<string, unknown>[] | null;

  @Column({ type: "jsonb", nullable: true })
  action_requests!: Record<string, unknown>[] | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
