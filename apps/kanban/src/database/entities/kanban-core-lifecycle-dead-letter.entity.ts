import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity("kanban_core_lifecycle_dead_letters")
export class KanbanCoreLifecycleDeadLetterEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  stream_key!: string;

  @Column({ type: "varchar", length: 64 })
  stream_id!: string;

  @Column({ type: "text" })
  reason!: string;

  @Column({ type: "jsonb", nullable: true })
  payload!: Record<string, unknown> | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
