import { BadRequestException, Injectable } from '@nestjs/common';
import type { InternalToolExecutionContext } from '@nexus/core';
import { WorkflowRunTodoService } from '../../workflow-run-operations/workflow-run-todo.service';
import { requireNonEmptyString } from '../../workflow-runtime/workflow-runtime-tools.helpers';
import type { WorkflowRunTodoInput } from '../../workflow-run-operations/workflow-run-todo.types';
import type { WorkflowRunTodoResponse } from '../../workflow-run-operations/workflow-run-todo.types';

type GetTodoListParams = {
  workflow_run_id?: string;
};

type ManageTodoListParams = {
  workflow_run_id?: string;
  todoList?: WorkflowRunTodoInput[];
  todo_list?: WorkflowRunTodoInput[];
};

@Injectable()
export class TodoToolsHandler {
  constructor(private readonly todoService: WorkflowRunTodoService) {}

  async getTodoList(
    params: GetTodoListParams,
    context: InternalToolExecutionContext,
  ): Promise<WorkflowRunTodoResponse> {
    const workflowRunId = this.resolveWorkflowRunId(
      params.workflow_run_id,
      context.workflowRunId,
    );
    return this.todoService.getTodoList(workflowRunId);
  }

  async manageTodoList(
    params: ManageTodoListParams,
    context: InternalToolExecutionContext,
  ): Promise<WorkflowRunTodoResponse> {
    const workflowRunId = this.resolveWorkflowRunId(
      params.workflow_run_id,
      context.workflowRunId,
    );
    const todoList = params.todoList ?? params.todo_list;
    if (!Array.isArray(todoList)) {
      throw new BadRequestException('todoList must be an array');
    }

    return this.todoService.updateTodoList({
      workflowRunId,
      todoList,
    });
  }

  private resolveWorkflowRunId(
    workflowRunId: string | undefined,
    contextWorkflowRunId: string | undefined,
  ): string {
    return requireNonEmptyString(
      workflowRunId ?? contextWorkflowRunId,
      'workflow_run_id',
    );
  }
}
