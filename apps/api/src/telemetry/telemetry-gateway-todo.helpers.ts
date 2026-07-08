import { BadRequestException } from '@nestjs/common';
import {
  ManageTodoListSchema,
  type ManageTodoListInput,
  type TodoItem,
} from '@nexus/core';
import type { AuthenticatedSocket } from './types';

interface TodoActionService {
  dispatchTodoAction(
    workflowRunId: string,
    input: ManageTodoListInput,
  ): Promise<TodoItem[]>;
}

export async function handleManageTodoListCompat(params: {
  client: AuthenticatedSocket;
  payload: Record<string, unknown>;
  todoService: TodoActionService;
}): Promise<void> {
  const { client, payload, todoService } = params;
  const workflowRunId = client.workflowRunId ?? '';

  if (!workflowRunId) {
    client.emit('manage_todo_list_result', {
      type: 'manage_todo_list_result',
      success: false,
      error: 'Missing workflow run context',
    });
    return;
  }

  const parsed = ManageTodoListSchema.safeParse({
    action: 'manage_todo_list',
    ...payload,
  });

  if (!parsed.success) {
    client.emit('manage_todo_list_result', {
      type: 'manage_todo_list_result',
      success: false,
      error: `Invalid input: ${parsed.error.message}`,
    });
    return;
  }

  try {
    const todos = await todoService.dispatchTodoAction(
      workflowRunId,
      parsed.data,
    );
    client.emit('manage_todo_list_result', {
      type: 'manage_todo_list_result',
      success: true,
      todos,
    });
  } catch (error) {
    const message =
      error instanceof BadRequestException
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Todo action failed';
    client.emit('manage_todo_list_result', {
      type: 'manage_todo_list_result',
      success: false,
      error: message,
    });
  }
}

export async function handleGetTodoListCompat(params: {
  client: AuthenticatedSocket;
  todoService: TodoActionService;
}): Promise<void> {
  const { client, todoService } = params;
  const workflowRunId = client.workflowRunId ?? '';

  if (!workflowRunId) {
    client.emit('get_todo_list_result', {
      type: 'get_todo_list_result',
      success: false,
      error: 'Missing workflow run context',
    });
    return;
  }

  try {
    const todos = await todoService.dispatchTodoAction(workflowRunId, {
      action: 'manage_todo_list',
      todo_action: 'list',
    });
    client.emit('get_todo_list_result', {
      type: 'get_todo_list_result',
      success: true,
      todos,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to retrieve todos';
    client.emit('get_todo_list_result', {
      type: 'get_todo_list_result',
      success: false,
      error: message,
    });
  }
}
