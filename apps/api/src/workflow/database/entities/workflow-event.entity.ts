import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('workflow_events')
@Index(['workflow_run_id', 'timestamp'])
export class WorkflowEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  workflow_run_id!: string;

  @Column()
  event_type!: string;

  @Column({ nullable: true })
  step_id?: string;

  @Column({ nullable: true })
  job_id?: string;

  @Column({ nullable: true })
  actor_id?: string;

  @Column({ nullable: true })
  correlation_id?: string;

  @Column({ type: 'jsonb', nullable: true })
  payload?: Record<string, unknown>;

  @CreateDateColumn()
  timestamp!: Date;
}
