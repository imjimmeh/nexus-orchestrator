import { Injectable } from '@nestjs/common';
import type {
  IInternalToolHandler,
  InternalToolExecutionContext,
  RuntimeCapabilityDefinition,
} from '@nexus/core';
import { GET_TODO_LIST_RUNTIME_CAPABILITY } from '../../../workflow-runtime/workflow-runtime-capability.contracts';
import { getTodoListBodySchema } from '@nexus/core';
import { TodoToolsHandler } from '../../handlers/todo-tools.handler';
import { WorkflowRunTodoService } from '../../../workflow-run-operations/workflow-run-todo.service';
import type {
  WorkflowRunTodoRecord,
  WorkflowRunTodoResponse,
} from '../../../workflow-run-operations/workflow-run-todo.types';
import type {
  ISystemPromptContributor,
  PromptAssemblyContext,
  PromptContributionBlock,
} from '../../../../system-prompt/system-prompt-contributor.types';

interface GetTodoListParams {
  workflow_run_id?: string;
}

const TODO_CONTRIBUTOR_PRIORITY = 50;

const TODO_INSTRUCTIONS = `\
Use the \`manage_todo_list\` tool to plan and track your work throughout this task. \
Keeping your todo list current lets the orchestrator monitor progress and surfaces \
your current step to other tools.

**When to use:**
- At the start of any multi-step task: add each step with status \`not-started\`
- When you begin a step: update it to \`in-progress\`
- When a step is done: update it to \`completed\`

**Rules:**
- Only one item may be \`in-progress\` at a time
- Pass the **full** list on every call — it replaces the previous state entirely
- Use the \`id\` field on existing items to update them in place

**Tool signature:** \`manage_todo_list({ todo_list: [{ id?, title, status }] })\`
Status values: \`"not-started"\` | \`"in-progress"\` | \`"completed"\``;

@Injectable()
export class GetTodoListTool
  implements
    IInternalToolHandler<GetTodoListParams, WorkflowRunTodoResponse>,
    ISystemPromptContributor
{
  readonly name = 'todo';
  readonly priority = TODO_CONTRIBUTOR_PRIORITY;

  constructor(
    private readonly todoTools: TodoToolsHandler,
    private readonly todoService: WorkflowRunTodoService,
  ) {}

  getName(): string {
    return 'get_todo_list';
  }

  getDefinition(): RuntimeCapabilityDefinition {
    return {
      ...GET_TODO_LIST_RUNTIME_CAPABILITY,
      inputSchema: getTodoListBodySchema,
    };
  }

  execute(
    context: InternalToolExecutionContext,
    params: GetTodoListParams,
  ): Promise<WorkflowRunTodoResponse> {
    return this.todoTools.getTodoList(params, context);
  }

  async contribute(
    ctx: PromptAssemblyContext,
  ): Promise<PromptContributionBlock | null> {
    if (ctx.runType !== 'workflow' || !ctx.workflowRunId) {
      return null;
    }

    const response = await this.todoService.getTodoList(ctx.workflowRunId);
    const stateSection = this.formatTodoList(response.todo_list);

    return {
      title: 'Todo List',
      content: `${TODO_INSTRUCTIONS}\n\n${stateSection}`,
      priority: TODO_CONTRIBUTOR_PRIORITY,
    };
  }

  private formatTodoList(todos: WorkflowRunTodoRecord[]): string {
    if (todos.length === 0) {
      return '*(No todos yet. Call `manage_todo_list` to add items.)*';
    }
    const rows = todos.map((todo) => {
      const icon =
        todo.status === 'completed'
          ? '✅'
          : todo.status === 'in-progress'
            ? '🔄'
            : '⬜';
      return `| ${icon} | ${todo.title} |`;
    });
    return `| Status | Task |\n|--------|------|\n${rows.join('\n')}`;
  }
}
