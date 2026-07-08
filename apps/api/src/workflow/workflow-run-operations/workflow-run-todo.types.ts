import type { WorkflowRun } from '../database/entities/workflow-run.entity';
import type {
  WorkflowRunTodoSourceKind,
  WorkflowRunTodoStatus,
} from '../database/entities/workflow-run-todo.types';
import type { ExecutionContext } from '@nexus/core';

export interface WorkflowRunTodoInput {
  id?: string;
  title?: string;
  status: WorkflowRunTodoStatus;
  source_context_item_id?: string;
}

export interface NormalizedWorkflowRunTodoInput {
  id: string | null;
  title: string | null;
  status: WorkflowRunTodoStatus;
  sourceContextItemId: string | null;
}

export interface WorkflowRunTodoRecord {
  id: string;
  title: string;
  status: WorkflowRunTodoStatus;
  order_index: number;
  source_kind: WorkflowRunTodoSourceKind;
  source_context_item_id: string | null;
  updated_at: string;
}

export interface WorkflowRunTodoSourceInfo {
  mode: 'manual' | 'context_source' | 'mixed';
  has_drift: boolean;
  stale_count: number;
}

export interface WorkflowRunTodoSummary {
  total_count: number;
  completed_count: number;
  in_progress_count: number;
  not_started_count: number;
}

export interface WorkflowRunTodoResponse {
  workflow_run_id: string;
  scope_id: string | null;
  context_id: string | null;
  todo_list: WorkflowRunTodoRecord[];
  summary: WorkflowRunTodoSummary;
  source: WorkflowRunTodoSourceInfo;
  _markdown: string;
}

export interface WorkflowRunTodoEntityLike {
  id: string;
  title: string;
  status: WorkflowRunTodoStatus;
  orderIndex: number;
  sourceKind: WorkflowRunTodoSourceKind;
  sourceContextItemId?: string | null;
  updatedAt: Date;
}

export type WorkflowRunStateScopeResolver = (
  run: WorkflowRun,
) => ExecutionContext;
