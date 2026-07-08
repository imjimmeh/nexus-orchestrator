import { Injectable } from '@nestjs/common';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
  ManageTodoListBodyInput,
} from '@nexus/core';
import { manageTodoListBodySchema } from '@nexus/core';
import { MANAGE_TODO_LIST_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { TodoToolsHandler } from '../../handlers/todo-tools.handler';
import type { WorkflowRunTodoResponse } from '../../../workflow-run-operations/workflow-run-todo.types';

type ManageTodoListParams = ManageTodoListBodyInput;

@Injectable()
export class ManageTodoListTool implements IInternalToolHandler<
  ManageTodoListParams,
  WorkflowRunTodoResponse
> {
  constructor(private readonly todoTools: TodoToolsHandler) {}

  getName(): string {
    return 'manage_todo_list';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      ...MANAGE_TODO_LIST_RUNTIME_CAPABILITY,
      inputSchema: manageTodoListBodySchema,
    };
  }

  execute(
    context: InternalToolExecutionContext,
    params: ManageTodoListParams,
  ): Promise<WorkflowRunTodoResponse> {
    return this.todoTools.manageTodoList(params, context);
  }
}
