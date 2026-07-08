import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("kanban_model_pricing_cache")
export class KanbanModelPricingCacheEntity {
  @PrimaryColumn({ type: "varchar" })
  model_id!: string;

  @Column({ type: "varchar", nullable: true })
  provider_name!: string | null;

  @Column({ type: "varchar" })
  model_name!: string;

  @Column({ type: "integer", nullable: true })
  input_token_cents_per_million!: number | null;

  @Column({ type: "integer", nullable: true })
  output_token_cents_per_million!: number | null;

  @CreateDateColumn({ type: "timestamp" })
  created_at!: Date;

  @UpdateDateColumn({ name: "synced_at", type: "timestamp" })
  synced_at!: Date;
}
