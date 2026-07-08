import { Column, Entity, Index, PrimaryColumn } from "typeorm";

type CoreRunLifecycleEventType =
  | "core.workflow.run.requested.v1"
  | "core.workflow.run.accepted.v1"
  | "core.workflow.run.status_changed.v1"
  | "core.workflow.run.completed.v1";

@Entity("kanban_core_run_projections")
@Index("idx_kanban_core_run_projections_project_id", ["project_id"])
export class KanbanCoreRunProjectionEntity {
  @PrimaryColumn({ type: "varchar", length: 255 })
  run_id!: string;

  @Column({ type: "varchar", length: 255 })
  workflow_id!: string;

  @Column({ type: "varchar", length: 128 })
  status!: string;

  @Column({ type: "varchar", length: 255, nullable: true })
  project_id!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  work_item_id!: string | null;

  @Column({ type: "timestamp" })
  occurred_at!: Date;

  @Column({ type: "varchar", length: 255 })
  last_event_id!: string;

  @Column({ type: "varchar", length: 255 })
  last_event_type!: CoreRunLifecycleEventType;
}
