import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_sync_operation_log")
export class KanbanSyncOperationLogEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  connection_id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ name: "work_item_id", type: "uuid", nullable: true })
  work_item_id!: string | null;

  @Column({ name: "external_id", type: "varchar", length: 255, nullable: true })
  external_id!: string | null;

  @Column({ type: "varchar", length: 32 })
  direction!: string;

  @Column({ type: "varchar", length: 32 })
  operation!: string;

  @Column({ type: "varchar", length: 32 })
  status!: string;

  @Column({ type: "text", nullable: true })
  message!: string | null;

  @Column({ type: "jsonb", default: {} })
  details!: Record<string, unknown>;

  @Column({ name: "started_at", type: "timestamp", default: () => "NOW()" })
  started_at!: Date;

  @Column({ name: "completed_at", type: "timestamp", nullable: true })
  completed_at!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updated_at!: Date;
}
