import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  ImportedRepositoryFindingDecision,
  ImportedRepositoryFindingEvidence,
  ImportedRepositoryFindingStatus,
  ImportedRepositoryFindingWorkType,
  WorkItemRecommendationStatus,
} from "../../orchestration/imported-repository-finding.types";

@Entity("kanban_imported_repository_findings")
@Index(
  "idx_kanban_imported_repository_findings_project_source",
  ["project_id", "source_id"],
  { unique: true },
)
@Index("idx_kanban_imported_repository_findings_project_status", [
  "project_id",
  "status",
  "updated_at",
])
@Index("idx_kanban_imported_repository_findings_project_work_item", [
  "project_id",
  "work_item_id",
])
export class KanbanImportedRepositoryFindingEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 255 })
  source_id!: string;

  @Column({ type: "varchar", length: 64 })
  source_hash!: string;

  @Column({ type: "varchar", length: 512 })
  probe_artifact_path!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  probe_scope_id!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  project_scope_id!: string | null;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "varchar", length: 64 })
  finding_kind!: ImportedRepositoryFindingWorkType;

  @Column({ type: "varchar", length: 64 })
  recommended_work_type!: ImportedRepositoryFindingWorkType;

  @Column({ type: "varchar", length: 32 })
  recommended_status!: WorkItemRecommendationStatus;

  @Column({ type: "varchar", length: 64 })
  status!: ImportedRepositoryFindingStatus;

  @Column({ type: "double precision", nullable: true })
  confidence_score!: number | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  evidence!: ImportedRepositoryFindingEvidence;

  @Column({ type: "jsonb", nullable: true })
  decision!: ImportedRepositoryFindingDecision | null;

  @Column({ type: "uuid", nullable: true })
  work_item_id!: string | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @Column({ type: "timestamp" })
  observed_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  resolved_at!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
