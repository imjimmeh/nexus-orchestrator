import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('budget_policies')
@Index(['scope_type', 'scope_id'])
@Index(['context_type', 'context_id'])
@Index(['is_active'])
export class BudgetPolicy {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255 })
  name!: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 64 })
  scope_type!: string;

  @Column({ name: 'scope_id', type: 'varchar', nullable: true })
  scope_id!: string | null;

  @Column({ name: 'context_type', type: 'varchar', length: 64, nullable: true })
  context_type!: string | null;

  @Column({ name: 'context_id', type: 'varchar', nullable: true })
  context_id!: string | null;

  @Column({ name: 'provider_name', type: 'varchar', nullable: true })
  provider_name!: string | null;

  @Column({ name: 'model_name', type: 'varchar', nullable: true })
  model_name!: string | null;

  @Column({ name: 'soft_limit_cents', type: 'integer', nullable: true })
  soft_limit_cents!: number | null;

  @Column({ name: 'hard_limit_cents', type: 'integer', nullable: true })
  hard_limit_cents!: number | null;

  @Column({ name: 'token_limit', type: 'integer', nullable: true })
  token_limit!: number | null;

  @Column({ type: 'varchar', length: 32 })
  window!: string;

  @Column({ name: 'enforcement_mode', type: 'varchar', length: 32 })
  enforcement_mode!: string;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  is_active!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;
}
