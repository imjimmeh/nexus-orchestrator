import { Column, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity("kanban_core_lifecycle_cursors")
export class KanbanCoreLifecycleCursorEntity {
  @PrimaryColumn({ type: "varchar", length: 128 })
  consumer_name!: string;

  @Column({ type: "varchar", length: 255 })
  stream_key!: string;

  @Column({ type: "varchar", length: 64 })
  stream_id!: string;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
