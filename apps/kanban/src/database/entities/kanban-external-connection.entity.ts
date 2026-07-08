import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_external_connections")
export class KanbanExternalConnectionEntity {
  @PrimaryColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ name: "provider_type", type: "varchar", length: 64 })
  provider_type!: string;

  @Column({ type: "varchar", length: 255 })
  name!: string;

  @Column({ type: "varchar", length: 32, default: "active" })
  status!: string;

  @Column({
    name: "sync_mode",
    type: "varchar",
    length: 32,
    default: "bidirectional",
  })
  sync_mode!: string;

  @Column({
    name: "sync_transport",
    type: "varchar",
    length: 32,
    default: "manual",
  })
  sync_transport!: string;

  @Column({ type: "jsonb", default: {} })
  config!: Record<string, unknown>;

  @Column({ name: "field_mapping", type: "jsonb", default: {} })
  field_mapping!: Record<string, unknown>;

  @Column({
    name: "webhook_secret_ref",
    type: "varchar",
    length: 255,
    nullable: true,
  })
  webhook_secret_ref!: string | null;

  @Column({ name: "poll_interval_seconds", type: "integer", nullable: true })
  poll_interval_seconds!: number | null;

  @Column({ name: "last_sync_at", type: "timestamp", nullable: true })
  last_sync_at!: Date | null;

  @Column({ name: "last_sync_error", type: "text", nullable: true })
  last_sync_error!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updated_at!: Date;
}
