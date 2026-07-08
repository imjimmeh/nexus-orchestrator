import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  KanbanRetrospectiveRunStatus,
  KanbanRetrospectiveSkipReason,
  KanbanRetrospectiveTriggerType,
} from "../../retrospectives/retrospective.types";

@Entity("kanban_retrospective_runs")
@Index("idx_kanban_retrospective_runs_idempotency_key", ["idempotency_key"], {
  unique: true,
})
@Index("idx_kanban_retrospective_runs_project_created", [
  "project_id",
  "created_at",
])
@Index("idx_kanban_retrospective_runs_status_created", ["status", "created_at"])
export class KanbanRetrospectiveRunEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  idempotency_key!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "uuid", nullable: true })
  orchestration_id!: string | null;

  @Column({ type: "varchar", length: 64 })
  trigger_type!: KanbanRetrospectiveTriggerType;

  @Column({ type: "varchar", length: 255, nullable: true })
  trigger_revision_marker!: string | null;

  @Column({ type: "uuid", nullable: true })
  replay_of_run_id!: string | null;

  @Column({ type: "varchar", length: 32 })
  status!: KanbanRetrospectiveRunStatus;

  @Column({ type: "varchar", length: 64, nullable: true })
  skip_reason!: KanbanRetrospectiveSkipReason | null;

  @Column({ type: "text", nullable: true })
  failure_reason!: string | null;

  @Column({ type: "integer", default: 0 })
  candidate_count!: number;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  learning_candidate_ids!: string[];

  @Column({ type: "jsonb", nullable: true })
  delta_snapshot_json!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  diagnostics_json!: Record<string, unknown> | null;

  @Column({ type: "timestamp" })
  started_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  completed_at!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
