import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

/**
 * A single charter item — one durable, human/agent-authored piece of
 * project intent (vision, requirement, constraint, decision, etc.).
 *
 * This is deliberately NOT stored in `memory_segments`: that table is
 * the AI runtime/learning memory store, swept by the decay and
 * eviction reapers and truncated by integration tests. The charter is
 * a source-of-truth document and must outlive all of that.
 */
@Entity("kanban_project_charter_items")
@Index("idx_kanban_project_charter_items_project", ["project_id"])
export class KanbanProjectCharterItemEntity {
  @PrimaryGeneratedColumn("uuid")
  id: string;

  @Column({ type: "uuid" })
  project_id: string;

  /** Charter category, e.g. "vision" | "requirement" | "constraint". */
  @Column({ type: "varchar", length: 64 })
  category: string;

  @Column({ type: "text" })
  content: string;

  /** Mirrors the old memory_type ("fact" | "preference" | "history"). */
  @Column({ type: "varchar", length: 32, default: "fact" })
  memory_type: string;

  /** Provenance, e.g. "onboarding_chat" | "user_edit". */
  @Column({ type: "varchar", length: 64, default: "user_edit" })
  source: string;

  @Column({ type: "int", default: 1 })
  version: number;

  @CreateDateColumn({ type: "timestamptz" })
  created_at: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updated_at: Date;
}
