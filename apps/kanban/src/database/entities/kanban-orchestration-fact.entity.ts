import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  OrchestrationEvidenceRef,
  OrchestrationFactFreshnessStatus,
} from "../../orchestration/control-plane/control-plane.types";

@Entity("kanban_orchestration_facts")
@Index("idx_kanban_orchestration_facts_project_subject", [
  "project_id",
  "subject_kind",
  "subject_id",
])
@Index("idx_kanban_orchestration_facts_project_type_freshness", [
  "project_id",
  "fact_type",
  "freshness_status",
])
export class KanbanOrchestrationFactEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 128 })
  fact_type!: string;

  @Column({ type: "varchar", length: 64 })
  subject_kind!: string;

  @Column({ type: "varchar", length: 255 })
  subject_id!: string;

  @Column({ type: "varchar", length: 64 })
  source_type!: string;

  @Column({ type: "varchar", length: 255 })
  source_id!: string;

  @Column({ type: "double precision" })
  confidence!: number;

  @Column({ type: "varchar", length: 32 })
  freshness_status!: OrchestrationFactFreshnessStatus;

  @Column({ type: "timestamp" })
  observed_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  expires_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  invalidated_at!: Date | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  invalidated_by_event_id!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  payload_json!: Record<string, unknown>;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  evidence!: OrchestrationEvidenceRef[];

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
