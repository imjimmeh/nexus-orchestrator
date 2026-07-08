import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import type {
  ArgumentPattern,
  ToolApprovalRuleEffect,
  ToolApprovalRuleScope,
} from './tool-approval-rule.types';

export type {
  ArgumentPattern,
  ToolApprovalRuleEffect,
  ToolApprovalRuleScope,
} from './tool-approval-rule.types';

@Entity('tool_approval_rules')
@Index(['scopeType', 'scopeId'])
@Index(['toolName'])
export class ToolApprovalRule {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', name: 'scope_type' })
  scopeType!: ToolApprovalRuleScope;

  @Column({ type: 'varchar', nullable: true, name: 'scope_id' })
  scopeId!: string | null;

  @Column({ type: 'varchar', name: 'tool_name' })
  toolName!: string;

  @Column({ type: 'varchar', name: 'effect' })
  effect!: ToolApprovalRuleEffect;

  @Column({ type: 'int', default: 0, name: 'priority' })
  priority!: number;

  @Column({ type: 'jsonb', nullable: true, name: 'argument_patterns' })
  argumentPatterns!: ArgumentPattern[] | null;

  @Column({ type: 'varchar', nullable: true, name: 'created_by' })
  createdBy!: string | null;

  @Column({ type: 'timestamptz', nullable: true, name: 'expires_at' })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
