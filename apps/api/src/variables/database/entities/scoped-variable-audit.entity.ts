import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity({ name: 'scoped_variable_audit' })
@Index(['scope_node_id', 'key'])
export class ScopedVariableAudit {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid', nullable: true })
  scope_node_id!: string | null;

  @Column({ type: 'varchar', length: 128 })
  key!: string;

  @Column({ type: 'varchar', length: 16 })
  action!: 'upsert' | 'delete';

  @Column({ type: 'jsonb', nullable: true })
  previous_value!: unknown;

  @Column({ type: 'jsonb', nullable: true })
  new_value!: unknown;

  @Column({ type: 'varchar', nullable: true })
  actor!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  created_at!: Date;
}
