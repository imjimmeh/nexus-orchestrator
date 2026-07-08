import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_settings")
export class KanbanSettingEntity {
  @PrimaryColumn({ type: "varchar", length: 100 })
  key!: string;

  @Column({ type: "jsonb" })
  value!: unknown;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamp" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp" })
  updatedAt!: Date;
}
