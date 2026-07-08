import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { LaunchAttemptStatus } from "../../orchestration/control-plane/control-plane.types";

@Entity("kanban_orchestration_launch_attempts")
@Index("idx_kanban_orchestration_launch_attempts_intent", ["intent_id"])
@Index("idx_kanban_orchestration_launch_attempts_project_created", [
  "project_id",
  "created_at",
])
@Index("idx_kanban_orchestration_launch_attempts_workflow_run", [
  "workflow_run_id",
])
export class KanbanOrchestrationLaunchAttemptEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  intent_id!: string;

  @Column({ type: "uuid", nullable: true })
  outcome_id!: string | null;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 255 })
  workflow_id!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  workflow_scope!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  workflow_run_id!: string | null;

  @Column({ type: "varchar", length: 255 })
  idempotency_key!: string;

  @Column({ type: "varchar", length: 32 })
  status!: LaunchAttemptStatus;

  @Column({ type: "text", nullable: true })
  failure_reason!: string | null;

  @Column({ type: "timestamp" })
  requested_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  completed_at!: Date | null;

  @Column({ type: "jsonb", nullable: true })
  response_payload!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
