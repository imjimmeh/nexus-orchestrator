import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type {
  ScopedVariableValueType,
  ScopedVariableSource,
} from '@nexus/core';

@Index('UQ_scoped_variable_key_scope', ['key', 'scope_node_id'], {
  unique: true,
})
@Entity('scoped_variables')
export class ScopedVariable {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    name: 'scope_node_id',
    type: 'uuid',
    nullable: true,
    default: null,
  })
  scope_node_id: string | null;

  @Column({ type: 'varchar', length: 128 })
  key: string;

  @Column({ type: 'jsonb' })
  value: unknown;

  @Column({ type: 'varchar', length: 16 })
  value_type: ScopedVariableValueType;

  @Column({ type: 'varchar', length: 16, default: 'admin' })
  source: ScopedVariableSource;

  @Column({ type: 'text', nullable: true, default: null })
  description: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  created_by: string | null;

  @Column({ type: 'varchar', nullable: true, default: null })
  updated_by: string | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;
}
