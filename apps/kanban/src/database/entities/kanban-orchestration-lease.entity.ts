import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type {
  OrchestrationConflictKeyKind,
  OrchestrationLane,
  OrchestrationLeaseOwnerKind,
  OrchestrationLeaseStatus,
} from "../../orchestration/control-plane/control-plane.types";

@Entity("kanban_orchestration_leases")
@Index("idx_kanban_orchestration_leases_project_status", [
  "project_id",
  "status",
])
@Index("idx_kanban_orchestration_leases_project_lane_status", [
  "project_id",
  "lane",
  "status",
])
export class KanbanOrchestrationLeaseEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 32 })
  conflict_key_kind!: OrchestrationConflictKeyKind;

  @Column({ type: "varchar", length: 512 })
  conflict_key_value!: string;

  @Column({ type: "varchar", length: 64 })
  lane!: OrchestrationLane;

  @Column({ type: "varchar", length: 32 })
  owner_kind!: OrchestrationLeaseOwnerKind;

  @Column({ type: "varchar", length: 255 })
  owner_id!: string;

  @Column({ type: "varchar", length: 16 })
  status!: OrchestrationLeaseStatus;

  @Column({ type: "timestamp" })
  acquired_at!: Date;

  @Column({ type: "timestamp" })
  heartbeat_at!: Date;

  @Column({ type: "timestamp" })
  expires_at!: Date;

  @Column({ type: "timestamp", nullable: true })
  released_at!: Date | null;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
