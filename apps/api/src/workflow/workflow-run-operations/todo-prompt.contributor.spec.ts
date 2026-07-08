import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TodoPromptContributor } from './todo-prompt.contributor';
import type { WorkflowRunTodoService } from './workflow-run-todo.service';
import type { SystemPromptAssemblyService } from '../../system-prompt/system-prompt-assembly.service';
import type { PromptAssemblyContext } from '../../system-prompt/system-prompt-contributor.types';
import type { WorkflowRunTodoResponse } from './workflow-run-todo.types';

const makeCtx = (
  overrides: Partial<PromptAssemblyContext> = {},
): PromptAssemblyContext => ({
  runType: 'workflow',
  workflowRunId: 'run-abc',
  baseLayers: [],
  ...overrides,
});

const makeTodoResponse = (
  todos: Array<{
    title: string;
    status: 'not-started' | 'in-progress' | 'completed';
  }>,
): WorkflowRunTodoResponse => ({
  workflow_run_id: 'run-abc',
  scope_id: null,
  context_id: null,
  todo_list: todos.map((t, i) => ({
    id: `todo-${i}`,
    title: t.title,
    status: t.status,
    order_index: i,
    source_kind: 'manual' as const,
    source_context_item_id: null,
    updated_at: new Date().toISOString(),
  })),
  summary: {
    total_count: todos.length,
    completed_count: todos.filter((t) => t.status === 'completed').length,
    in_progress_count: todos.filter((t) => t.status === 'in-progress').length,
    not_started_count: todos.filter((t) => t.status === 'not-started').length,
  },
  source: { mode: 'manual', has_drift: false, stale_count: 0 },
  _markdown: '',
});

describe('TodoPromptContributor', () => {
  let contributor: TodoPromptContributor;
  let todoService: Pick<WorkflowRunTodoService, 'getTodoList'>;
  let assemblyService: Pick<SystemPromptAssemblyService, 'register'>;

  beforeEach(() => {
    todoService = { getTodoList: vi.fn() };
    assemblyService = { register: vi.fn() };
    contributor = new TodoPromptContributor(
      todoService as WorkflowRunTodoService,
      assemblyService as SystemPromptAssemblyService,
    );
  });

  it('has name "todo" and priority 50', () => {
    expect(contributor.name).toBe('todo');
    expect(contributor.priority).toBe(50);
  });

  it('registers itself with the assembly service on module init', () => {
    contributor.onModuleInit();
    expect(assemblyService.register).toHaveBeenCalledWith(contributor);
  });

  it('returns null for chat context', async () => {
    const result = await contributor.contribute(
      makeCtx({ runType: 'chat', workflowRunId: undefined }),
    );
    expect(result).toBeNull();
    expect(todoService.getTodoList).not.toHaveBeenCalled();
  });

  it('returns null when workflowRunId is absent', async () => {
    const result = await contributor.contribute(
      makeCtx({ workflowRunId: undefined }),
    );
    expect(result).toBeNull();
    expect(todoService.getTodoList).not.toHaveBeenCalled();
  });

  it('calls getTodoList with the workflowRunId from context', async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    await contributor.contribute(makeCtx({ workflowRunId: 'run-xyz' }));
    expect(todoService.getTodoList).toHaveBeenCalledWith('run-xyz');
  });

  it('returns block with title "Todo List" and priority 50', async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    const result = await contributor.contribute(makeCtx());
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Todo List');
    expect(result!.priority).toBe(50);
  });

  it('block content includes manage_todo_list instructions when list is empty', async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([]),
    );
    const result = await contributor.contribute(makeCtx());
    expect(result!.content).toContain('manage_todo_list');
    expect(result!.content).toContain('No todos yet');
  });

  it('block content includes formatted table with status icons when todos are present', async () => {
    (todoService.getTodoList as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeTodoResponse([
        { title: 'Set up schema', status: 'completed' },
        { title: 'Implement service', status: 'in-progress' },
        { title: 'Write tests', status: 'not-started' },
      ]),
    );
    const result = await contributor.contribute(makeCtx());
    expect(result!.content).toContain('✅');
    expect(result!.content).toContain('🔄');
    expect(result!.content).toContain('⬜');
    expect(result!.content).toContain('Set up schema');
    expect(result!.content).toContain('Implement service');
    expect(result!.content).toContain('Write tests');
  });
});
