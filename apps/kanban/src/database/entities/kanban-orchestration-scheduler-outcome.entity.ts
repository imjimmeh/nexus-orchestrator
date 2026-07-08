import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import type {
  OrchestrationConflictKey,
  SchedulerOutcomeReason,
  SchedulerOutcomeStatus,
} from "../../orchestration/control-plane/control-plane.types";

@Entity("kanban_orchestration_scheduler_outcomes")
@Index("idx_kanban_orchestration_scheduler_outcomes_intent_created", [
  "intent_id",
  "created_at",
])
@Index("idx_kanban_orchestration_scheduler_outcomes_project_status", [
  "project_id",
  "status",
])
export class KanbanOrchestrationSchedulerOutcomeEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  intent_id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 32 })
  status!: SchedulerOutcomeStatus;

  @Column({ type: "varchar", length: 96 })
  reason!: SchedulerOutcomeReason;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  conflict_keys!: OrchestrationConflictKey[];

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  active_conflicts!: OrchestrationConflictKey[];

  @Column({ type: "timestamp" })
  evaluated_at!: Date;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  policy_snapshot!: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
