import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_initiatives")
@Index("idx_kanban_initiatives_project_id", ["project_id"])
export class KanbanInitiativeEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  project_id!: string;

  @Column({ type: "varchar", length: 255 })
  title!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 16, default: "next" })
  horizon!: string;

  @Column({ type: "integer", default: 0 })
  priority!: number;

  @Column({ type: "varchar", length: 16, default: "proposed" })
  status!: string;

  @Column({ type: "timestamp", nullable: true })
  last_reviewed_at!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ type: "timestamp" })
  updated_at!: Date;
}
