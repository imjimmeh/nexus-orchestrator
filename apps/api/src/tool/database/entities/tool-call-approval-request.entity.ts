import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type { ToolCallApprovalStatus } from './tool-call-approval-request.types';

export type { ToolCallApprovalStatus } from './tool-call-approval-request.types';

@Entity('tool_call_approval_requests')
@Index(['status'])
@Index(['scopeId', 'status'])
@Index(['workflowRunId', 'status'])
@Index(['chatSessionId', 'status'])
export class ToolCallApprovalRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', name: 'workflow_run_id' })
  workflowRunId!: string;

  @Column({ type: 'varchar', name: 'job_id' })
  jobId!: string;

  @Column({ type: 'varchar', nullable: true, name: 'scope_id' })
  scopeId!: string | null;

  @Column({ type: 'varchar', nullable: true, name: 'chat_session_id' })
  chatSessionId!: string | null;

  @Column({ type: 'varchar', name: 'tool_name' })
  toolName!: string;

  @Column({ type: 'jsonb', name: 'tool_arguments' })
  toolArguments!: Record<string, unknown>;

  @Column({ type: 'varchar', name: 'requested_by' })
  requestedBy!: string;

  @Column({ type: 'varchar', default: 'pending' })
  status!: ToolCallApprovalStatus;

  @Column({ type: 'varchar', nullable: true, name: 'approved_by' })
  approvedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'approved_at' })
  approvedAt!: Date | null;

  @Column({ type: 'varchar', nullable: true, name: 'rejected_by' })
  rejectedBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'rejected_at' })
  rejectedAt!: Date | null;

  @Column({ type: 'text', nullable: true, name: 'rejection_reason' })
  rejectionReason!: string | null;

  @Column({ type: 'uuid', nullable: true, name: 'resolution_rule_id' })
  resolutionRuleId!: string | null;

  @Column({ type: 'varchar', unique: true, name: 'correlation_id' })
  correlationId!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
