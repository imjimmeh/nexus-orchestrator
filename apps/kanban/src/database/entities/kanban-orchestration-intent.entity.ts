import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  OrchestrationConflictKey,
  OrchestrationEvidenceRef,
  OrchestrationIntentStatus,
  OrchestrationIntentType,
  OrchestrationLane,
  OrchestrationResourceRef,
} from "../../orchestration/control-plane/control-plane.types";

@Entity("kanban_orchestration_intents")
@Index("idx_kanban_orchestration_intents_project_lane_status", [
  "project_id",
  "lane",
  "status",
])
@Index(
  "idx_kanban_orchestration_intents_idempotency_key",
  ["idempotency_key"],
  { unique: true },
)
export class KanbanOrchestrationIntentEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 64 })
  lane!: OrchestrationLane;

  @Column({ type: "varchar", length: 96 })
  type!: OrchestrationIntentType;

  @Column({ type: "varchar", length: 32 })
  status!: OrchestrationIntentStatus;

  @Column({ type: "varchar", length: 128 })
  requester!: string;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "integer", default: 0 })
  priority!: number;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  evidence!: OrchestrationEvidenceRef[];

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  resource_refs!: OrchestrationResourceRef[];

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  conflict_keys!: OrchestrationConflictKey[];

  @Column({ type: "varchar", length: 255, nullable: true })
  workflow_id!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  workflow_scope!: string | null;

  @Column({ type: "varchar", length: 255 })
  idempotency_key!: string;

  @Column({ type: "uuid", nullable: true })
  supersedes_intent_id!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  freshness_requirements!: Record<string, unknown>;

  @Column({ type: "varchar", length: 96, nullable: true })
  terminal_outcome!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
