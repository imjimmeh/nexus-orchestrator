import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { ModelUsageBreakdownRow } from "./kanban-work-item-run-cost.entity.types";

@Entity("kanban_work_item_run_costs")
@Index("idx_kanban_work_item_run_costs_work_item", ["work_item_id"])
@Index("idx_kanban_work_item_run_costs_run_id", ["run_id"], { unique: true })
@Index("idx_kanban_work_item_run_costs_bucket", [
  "workflow_id",
  "type",
  "story_points",
])
export class KanbanWorkItemRunCostEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "uuid" })
  work_item_id!: string;

  @Column({ type: "varchar" })
  run_id!: string;

  @Column({ type: "varchar", nullable: true })
  workflow_id!: string | null;

  @Column({ type: "varchar", length: 16 })
  type!: string;

  @Column({ type: "smallint", nullable: true })
  story_points!: number | null;

  @Column({ type: "varchar", length: 32 })
  priority!: string;

  @Column({ type: "int" })
  attempt_number!: number;

  @Column({ type: "boolean" })
  is_retry!: boolean;

  @Column({ type: "jsonb" })
  model_breakdown!: ModelUsageBreakdownRow[];

  @Column({ type: "integer" })
  total_input_tokens!: number;

  @Column({ type: "integer" })
  total_output_tokens!: number;

  @Column({ type: "integer" })
  total_cost_cents!: number;

  @Column({ type: "integer", default: 0 })
  priced_turn_count!: number;

  @Column({ type: "timestamp", nullable: true })
  started_at!: Date | null;

  @Column({ type: "timestamp", nullable: true })
  completed_at!: Date | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;
}
