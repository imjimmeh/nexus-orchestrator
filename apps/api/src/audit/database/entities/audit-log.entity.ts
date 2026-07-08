import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  @Index()
  event_type!: string; // ToolExecution, WorkflowTransition, AuthFailure, etc.

  @Column()
  @Index()
  actor_id!: string; // agent ID, user ID

  @Column({ nullable: true })
  @Index()
  resource_id?: string; // workflow_run_id, tool_id

  @Column()
  action!: string; // executed, transitioned, denied

  @Column()
  result!: string; // success, failure

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  @Index()
  timestamp!: Date;
}
