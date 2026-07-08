import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('orchestration_session_states')
@Index('idx_orchestration_session_states_scope_id', ['scopeId'], {
  unique: true,
})
export class OrchestrationSessionState {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'scope_id', type: 'uuid' })
  scopeId!: string;

  @Column({ name: 'schema_version', type: 'int', default: 1 })
  schemaVersion!: number;

  @Column({ name: 'last_session_id', type: 'varchar', nullable: true })
  lastSessionId!: string | null;

  @Column({ name: 'state_json', type: 'jsonb', default: () => "'{}'::jsonb" })
  stateJson!: Record<string, unknown>;

  @Column({ name: 'session_lock', type: 'jsonb', nullable: true })
  sessionLock!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
