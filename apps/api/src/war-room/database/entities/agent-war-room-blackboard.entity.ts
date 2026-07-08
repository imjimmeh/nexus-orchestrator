import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('agent_war_room_blackboard')
@Index(
  'idx_agent_war_room_blackboard_session_version_unique',
  ['session_id', 'version'],
  {
    unique: true,
  },
)
export class AgentWarRoomBlackboard {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  session_id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column({ type: 'int' })
  version!: number;

  @Column({ type: 'text', nullable: true })
  strategy_summary?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  risks?: unknown[] | null;

  @Column({ type: 'jsonb', nullable: true })
  decision_log?: unknown[] | null;

  @Column({ type: 'text', nullable: true })
  implementation_plan_ref?: string | null;

  @Column({ type: 'varchar', nullable: true })
  updated_by_execution_id?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  created_at!: Date;
}
