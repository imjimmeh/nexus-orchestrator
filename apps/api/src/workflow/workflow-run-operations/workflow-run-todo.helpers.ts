import { BadRequestException } from '@nestjs/common';
import {
  asRecord,
  createExecutionContext,
  normalizeOptionalString,
  TodoStatusSchema,
  type ExecutionContext,
  isUuid,
} from '@nexus/core';
import type { TodoItem } from '@nexus/core';
import type { WorkflowRun } from '../database/entities/workflow-run.entity';
import type { WorkflowRunTodo } from '../database/entities/workflow-run-todo.entity';
import type {
  WorkflowRunTodoSourceKind,
  WorkflowRunTodoStatus,
} from '../database/entities/workflow-run-todo.types';
import type {
  NormalizedWorkflowRunTodoInput,
  WorkflowRunTodoEntityLike,
  WorkflowRunTodoInput,
  WorkflowRunTodoRecord,
  WorkflowRunTodoSummary,
} from './workflow-run-todo.types';

type ContextItemStatus = 'todo' | 'in_progress' | 'done';

interface ContextItemOrderKey {
  orderIndex: number;
  contextItemId: string;
}

const TODO_STATUS_VALUES = new Set<WorkflowRunTodoStatus>(
  TodoStatusSchema.options as readonly WorkflowRunTodoStatus[],
);

const TODO_STATUS_ERROR_SUFFIX = TodoStatusSchema.options.join(', ');

export function resolveWorkflowRunScope(run: WorkflowRun): ExecutionContext {
  const triggerRecord = resolveTriggerRecord(run.state_variables);
  if (!triggerRecord) {
    return createExecutionContext();
  }

  const contextRecord = asRecord(
    triggerRecord.resource ?? triggerRecord.context,
  );
  const scopeId = firstNonEmptyString(
    triggerRecord.scopeId,
    triggerRecord.scopeId,
    triggerRecord.scope_id,
  );
  const contextId = firstNonEmptyString(
    triggerRecord.contextId,
    triggerRecord.context_id,
    contextRecord?.id,
  );

  if (scopeId) {
    return createExecutionContext({
      scopeId: scopeId,
      contextId: contextId ?? scopeId,
      contextType: contextId ? 'resource' : 'scope',
      metadata: contextId ? { contextId } : {},
    });
  }

  if (contextId) {
    return createExecutionContext({
      scopeId: null,
      contextId: contextId,
      contextType: 'resource',
    });
  }

  return createExecutionContext();
}

function resolveTriggerRecord(
  stateVariables: unknown,
): Record<string, unknown> | null {
  const stateRecord = asRecord(stateVariables);
  return asRecord(stateRecord?.trigger);
}

function firstNonEmptyString(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizeOptionalString(value);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

export function normalizeTodoInputs(
  todoList: WorkflowRunTodoInput[],
): NormalizedWorkflowRunTodoInput[] {
  if (!Array.isArray(todoList)) {
    throw new BadRequestException('todo_list must be an array');
  }

  return todoList.map((item, index) => normalizeTodoInput(item, index));
}

export function assertSingleInProgress(
  items: NormalizedWorkflowRunTodoInput[],
): void {
  const inProgressCount = items.filter(
    (item) => item.status === 'in-progress',
  ).length;

  if (inProgressCount > 1) {
    throw new BadRequestException(
      'Only one todo item can be in-progress at a time',
    );
  }
}

function normalizeTodoInput(
  item: WorkflowRunTodoInput,
  index: number,
): NormalizedWorkflowRunTodoInput {
  if (!item || typeof item !== 'object') {
    throw new BadRequestException(
      `todo_list[${String(index)}] must be an object`,
    );
  }

  const status = normalizeStatus(item.status, index);
  const id = normalizeOptionalString(item.id);
  const title = normalizeOptionalString(item.title);
  const sourceContextItemId = normalizeOptionalString(
    item.source_context_item_id,
  );

  if (!title && !id) {
    throw new BadRequestException(
      `todo_list[${String(index)}] requires either id or title`,
    );
  }

  return {
    id,
    title,
    status,
    sourceContextItemId,
  };
}

function normalizeStatus(value: unknown, index: number): WorkflowRunTodoStatus {
  if (typeof value !== 'string') {
    throw new BadRequestException(
      `todo_list[${String(index)}].status must be a string`,
    );
  }

  const normalized = value.trim();
  if (!TODO_STATUS_VALUES.has(normalized as WorkflowRunTodoStatus)) {
    throw new BadRequestException(
      `todo_list[${String(index)}].status must be one of ${TODO_STATUS_ERROR_SUFFIX}`,
    );
  }

  return normalized as WorkflowRunTodoStatus;
}

export function mapContextItemStatusToTodoStatus(
  status: ContextItemStatus,
): WorkflowRunTodoStatus {
  if (status === 'done') {
    return 'completed';
  }

  if (status === 'in_progress') {
    return 'in-progress';
  }

  return 'not-started';
}

export function mapTodoStatusToContextItemStatus(
  status: WorkflowRunTodoStatus,
): ContextItemStatus {
  if (status === 'completed') {
    return 'done';
  }

  if (status === 'in-progress') {
    return 'in_progress';
  }

  return 'todo';
}

export function toWorkflowRunTodoRecord(
  record: WorkflowRunTodoEntityLike,
): WorkflowRunTodoRecord {
  return {
    id: record.id,
    title: record.title,
    status: record.status,
    order_index: record.orderIndex,
    source_kind: record.sourceKind,
    source_context_item_id: record.sourceContextItemId ?? null,
    updated_at: record.updatedAt.toISOString(),
  };
}

export function summarizeTodoList(
  todoList: WorkflowRunTodoRecord[],
): WorkflowRunTodoSummary {
  const summary: WorkflowRunTodoSummary = {
    total_count: todoList.length,
    completed_count: 0,
    in_progress_count: 0,
    not_started_count: 0,
  };

  for (const item of todoList) {
    if (item.status === 'completed') {
      summary.completed_count += 1;
      continue;
    }

    if (item.status === 'in-progress') {
      summary.in_progress_count += 1;
      continue;
    }

    summary.not_started_count += 1;
  }

  return summary;
}

export function resolveTodoSourceMode(params: {
  linkedCount: number;
  totalCount: number;
}): 'manual' | 'context_source' | 'mixed' {
  if (params.linkedCount === 0) {
    return 'manual';
  }

  if (params.linkedCount === params.totalCount) {
    return 'context_source';
  }

  return 'mixed';
}

export function toUuidOrNull(value: string | null): string | null {
  if (!value) {
    return null;
  }

  return isUuid(value) ? value : null;
}

export function toTodoItem(
  record: Pick<WorkflowRunTodo, 'orderIndex' | 'title' | 'status'>,
): TodoItem {
  return {
    id: record.orderIndex + 1,
    text: record.title,
    status: record.status,
  };
}

export function resolveSourceKind(
  sourceContextItemId: string | null,
): WorkflowRunTodoSourceKind {
  return sourceContextItemId ? 'context_source' : 'manual';
}

export function collectLinkedRecords(
  records: WorkflowRunTodo[],
): Array<WorkflowRunTodo & { sourceContextItemId: string }> {
  return records.filter(
    (record): record is WorkflowRunTodo & { sourceContextItemId: string } =>
      record.sourceKind === 'context_source' &&
      typeof record.sourceContextItemId === 'string' &&
      record.sourceContextItemId.length > 0,
  );
}

export function compareContextItemsByOrderAndId(
  left: ContextItemOrderKey,
  right: ContextItemOrderKey,
): number {
  if (left.orderIndex !== right.orderIndex) {
    return left.orderIndex - right.orderIndex;
  }

  return left.contextItemId.localeCompare(right.contextItemId);
}
