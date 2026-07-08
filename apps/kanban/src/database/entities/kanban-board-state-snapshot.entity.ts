import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_board_state_snapshots")
@Index("idx_kanban_board_state_snapshots_project_id", ["project_id"])
@Index(
  "idx_kanban_board_state_snapshots_idempotency_key",
  ["project_id", "idempotency_key"],
  { unique: true },
)
export class KanbanBoardStateSnapshotEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 255 })
  idempotency_key!: string;

  @Column({ type: "jsonb" })
  snapshot_data!: Record<string, unknown>;

  @Column({ name: "work_item_count", type: "integer", default: 0 })
  work_item_count!: number;

  @Column({ name: "column_distribution", type: "jsonb", default: "{}" })
  column_distribution!: Record<string, number>;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
