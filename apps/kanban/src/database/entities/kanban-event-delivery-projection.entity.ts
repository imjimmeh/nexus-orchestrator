import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { KanbanEventDeliveryStatus } from "../repositories/kanban-event-delivery-projection.types";

@Entity("kanban_event_delivery_projections")
@Index("idx_kanban_event_delivery_event_id", ["event_id"], { unique: true })
@Index("idx_kanban_event_delivery_project_status", ["project_id", "status"])
export class KanbanEventDeliveryProjectionEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  event_id!: string;

  @Column({ type: "varchar", length: 255 })
  event_name!: string;

  @Column({ type: "uuid", nullable: true })
  project_id!: string | null;

  @Column({ type: "uuid", nullable: true })
  work_item_id!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  workflow_run_id!: string | null;

  @Column({ type: "varchar", length: 255, nullable: true })
  dedupe_key!: string | null;

  @Column({ type: "varchar", length: 32 })
  status!: KanbanEventDeliveryStatus;

  @Column({ type: "integer", default: 0 })
  replay_count!: number;

  @Column({ type: "timestamp", nullable: true })
  last_attempted_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  accepted_at!: Date | null;

  @Column({ type: "text", nullable: true })
  last_error!: string | null;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  payload_snapshot!: Record<string, unknown>;

  @Column({ type: "jsonb", nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
