import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { WorkflowRun } from './workflow-run.entity';
import type {
  WorkflowRunTodoSourceKind,
  WorkflowRunTodoStatus,
} from './workflow-run-todo.types';

@Entity('workflow_run_todos')
@Index('idx_workflow_run_todos_run_id', ['workflowRunId'])
@Index('idx_workflow_run_todos_scope_id', ['scopeId'])
@Index('idx_workflow_run_todos_context_id', ['contextId'])
@Index(
  'uq_workflow_run_todos_run_context_item',
  ['workflowRunId', 'sourceContextItemId'],
  {
    unique: true,
    where: '"source_context_item_id" IS NOT NULL',
  },
)
export class WorkflowRunTodo {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workflow_run_id' })
  workflowRunId!: string;

  @ManyToOne(() => WorkflowRun, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workflow_run_id' })
  workflowRun!: WorkflowRun;

  @Column({ name: 'scope_id', type: 'uuid', nullable: true })
  scopeId?: string | null;

  @Column({ name: 'context_id', type: 'uuid', nullable: true })
  contextId?: string | null;

  @Column({ type: 'varchar', length: 500 })
  title!: string;

  @Column({ type: 'varchar', length: 32, default: 'not-started' })
  status!: WorkflowRunTodoStatus;

  @Column({ name: 'order_index', type: 'integer', default: 0 })
  orderIndex!: number;

  @Column({
    name: 'source_context_item_id',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  sourceContextItemId?: string | null;

  @Column({
    name: 'source_kind',
    type: 'varchar',
    length: 32,
    default: 'manual',
  })
  sourceKind!: WorkflowRunTodoSourceKind;

  @Column({ name: 'is_archived', type: 'boolean', default: false })
  isArchived!: boolean;

  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
