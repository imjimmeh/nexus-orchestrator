import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('cost_tracking')
export class CostTracking {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  resource_type!: string; // LLM, Compute, Storage

  @Column({ nullable: true })
  model?: string;

  @Column({ type: 'float', default: 0 })
  units_consumed!: number; // tokens, hours, GB

  @Column({ type: 'float', default: 0 })
  cost_usd!: number;

  @Column({ nullable: true })
  workflow_run_id?: string;

  @CreateDateColumn()
  @Index()
  timestamp!: Date;
}
