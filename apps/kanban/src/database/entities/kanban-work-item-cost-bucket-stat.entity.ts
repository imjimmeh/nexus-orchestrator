import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_work_item_cost_bucket_stats")
@Index(
  "idx_kanban_cost_bucket_stats_key",
  ["tier", "workflow_id", "type", "story_points"],
  { unique: true },
)
export class KanbanWorkItemCostBucketStatEntity {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 32 })
  tier!: string;

  @Column({ type: "varchar", nullable: true })
  workflow_id!: string | null;

  @Column({ type: "varchar", length: 16 })
  type!: string;

  @Column({ type: "smallint", nullable: true })
  story_points!: number | null;

  @Column({ type: "integer" })
  sample_count!: number;

  @Column({ type: "double precision" })
  mean_input_tokens!: number;

  @Column({ type: "double precision" })
  p25_input_tokens!: number;

  @Column({ type: "double precision" })
  p75_input_tokens!: number;

  @Column({ type: "double precision" })
  mean_output_tokens!: number;

  @Column({ type: "double precision" })
  p25_output_tokens!: number;

  @Column({ type: "double precision" })
  p75_output_tokens!: number;

  @Column({ type: "double precision", default: 0 })
  mean_priced_turn_count!: number;

  @Column({ type: "double precision", default: 0 })
  p25_priced_turn_count!: number;

  @Column({ type: "double precision", default: 0 })
  p75_priced_turn_count!: number;

  @UpdateDateColumn({ type: "timestamp" })
  computed_at!: Date;
}
