import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  getScopeId,
  getContextId,
  type ExecutionContext,
  type ManageTodoListInput,
  type TodoItem,
} from '@nexus/core';
import type { WorkflowRunTodo } from '../database/entities/workflow-run-todo.entity';
import type { WorkflowRunTodoStatus } from '../database/entities/workflow-run-todo.types';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRunTodoRepository } from '../database/repositories/workflow-run-todo.repository';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import {
  assertSingleInProgress,
  collectLinkedRecords,
  normalizeTodoInputs,
  resolveTodoSourceMode,
  resolveSourceKind,
  resolveWorkflowRunScope,
  summarizeTodoList,
  toTodoItem,
  toUuidOrNull,
  toWorkflowRunTodoRecord,
} from './workflow-run-todo.helpers';
import type {
  NormalizedWorkflowRunTodoInput,
  WorkflowRunTodoEntityLike,
  WorkflowRunTodoInput,
  WorkflowRunTodoResponse,
  WorkflowRunTodoSourceInfo,
} from './workflow-run-todo.types';

interface WorkflowRunTodoUpdateResult {
  linkedContextItemStatuses: Map<string, WorkflowRunTodoStatus>;
  persistedIds: string[];
}

interface WorkflowRunTodoRecordMaps {
  byId: Map<string, WorkflowRunTodo>;
  byContextItemId: Map<string, WorkflowRunTodo>;
}

@Injectable()
export class WorkflowRunTodoService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepository: IWorkflowRunRepository,
    private readonly workflowRunTodoRepository: WorkflowRunTodoRepository,
    private readonly stepEventPublisher: StepEventPublisherService,
  ) {}

  async getTodoList(workflowRunId: string): Promise<WorkflowRunTodoResponse> {
    const run = await this.requireRun(workflowRunId);
    const scope = resolveWorkflowRunScope(run);
    const records = await this.loadOrSeedRecords(workflowRunId, scope);

    return this.buildResponse(workflowRunId, scope, records);
  }

  async updateTodoList(params: {
    workflowRunId: string;
    todoList: WorkflowRunTodoInput[];
  }): Promise<WorkflowRunTodoResponse> {
    const run = await this.requireRun(params.workflowRunId);
    const scope = resolveWorkflowRunScope(run);
    const normalizedInputs = normalizeTodoInputs(params.todoList);

    assertSingleInProgress(normalizedInputs);

    const existingRecords = await this.loadOrSeedRecords(
      params.workflowRunId,
      scope,
    );

    const updateResult = await this.applyTodoUpdates({
      workflowRunId: params.workflowRunId,
      scope,
      existingRecords,
      normalizedInputs,
    });

    await this.workflowRunTodoRepository.archiveMissing(
      params.workflowRunId,
      updateResult.persistedIds,
    );

    await this.syncContextItemStatuses(
      getContextId(scope),
      updateResult.linkedContextItemStatuses,
    );

    const refreshed = await this.workflowRunTodoRepository.findByWorkflowRunId(
      params.workflowRunId,
    );

    return this.buildResponse(params.workflowRunId, scope, refreshed);
  }

  async dispatchTodoAction(
    workflowRunId: string,
    input: ManageTodoListInput,
  ): Promise<TodoItem[]> {
    await this.requireRun(workflowRunId);

    switch (input.todo_action) {
      case 'add':
        return this.addAgentTodo(workflowRunId, input.text ?? '');
      case 'start':
        return this.startAgentTodo(workflowRunId, input.id ?? 0);
      case 'complete':
        return this.completeAgentTodo(workflowRunId, input.id ?? 0);
      case 'list':
        return this.listAgentTodos(workflowRunId);
      case 'clear':
        return this.clearAgentTodos(workflowRunId);
    }
  }

  private async loadOrSeedRecords(
    workflowRunId: string,
    _scope: ExecutionContext,
  ): Promise<WorkflowRunTodo[]> {
    const records =
      await this.workflowRunTodoRepository.findByWorkflowRunId(workflowRunId);

    if (records.length > 0) {
      return records;
    }

    return records;
  }

  private async applyTodoUpdates(params: {
    workflowRunId: string;
    scope: ExecutionContext;
    existingRecords: WorkflowRunTodo[];
    normalizedInputs: NormalizedWorkflowRunTodoInput[];
  }): Promise<WorkflowRunTodoUpdateResult> {
    const maps = this.buildRecordMaps(params.existingRecords);
    const linkedContextItemStatuses = new Map<string, WorkflowRunTodoStatus>();
    const persistedIds: string[] = [];

    for (let index = 0; index < params.normalizedInputs.length; index += 1) {
      const input = params.normalizedInputs[index];
      const fallbackRecord = params.existingRecords[index];
      const matchedRecord = this.resolveMatchedRecord(
        input,
        fallbackRecord,
        maps,
      );

      const persisted = matchedRecord
        ? await this.updateExistingRecord({
            matchedRecord,
            input,
            index,
            scope: params.scope,
          })
        : await this.createRecord({
            workflowRunId: params.workflowRunId,
            input,
            index,
            scope: params.scope,
          });

      persistedIds.push(persisted.id);
      if (persisted.sourceContextItemId) {
        linkedContextItemStatuses.set(
          persisted.sourceContextItemId,
          input.status,
        );
      }
    }

    return {
      linkedContextItemStatuses,
      persistedIds,
    };
  }

  private buildRecordMaps(
    records: WorkflowRunTodo[],
  ): WorkflowRunTodoRecordMaps {
    const byId = new Map(records.map((record) => [record.id, record]));

    const contextItemPairs = records
      .filter(
        (record): record is WorkflowRunTodo & { sourceContextItemId: string } =>
          typeof record.sourceContextItemId === 'string' &&
          record.sourceContextItemId.length > 0,
      )
      .map((record) => [record.sourceContextItemId, record] as const);

    return {
      byId,
      byContextItemId: new Map(contextItemPairs),
    };
  }

  private resolveMatchedRecord(
    input: NormalizedWorkflowRunTodoInput,
    fallbackRecord: WorkflowRunTodo | undefined,
    maps: WorkflowRunTodoRecordMaps,
  ): WorkflowRunTodo | undefined {
    if (input.id) {
      return maps.byId.get(input.id) ?? fallbackRecord;
    }

    if (input.sourceContextItemId) {
      return (
        maps.byContextItemId.get(input.sourceContextItemId) ?? fallbackRecord
      );
    }

    return fallbackRecord;
  }

  private async updateExistingRecord(params: {
    matchedRecord: WorkflowRunTodo;
    input: NormalizedWorkflowRunTodoInput;
    index: number;
    scope: ExecutionContext;
  }): Promise<WorkflowRunTodo> {
    const nextSourceContextItemId =
      params.input.sourceContextItemId ??
      params.matchedRecord.sourceContextItemId ??
      null;

    const updated = await this.workflowRunTodoRepository.update(
      params.matchedRecord.id,
      {
        scopeId: getScopeId(params.scope),
        contextId: toUuidOrNull(getContextId(params.scope)),
        title: params.input.title ?? params.matchedRecord.title,
        status: params.input.status,
        orderIndex: params.index,
        sourceContextItemId: nextSourceContextItemId,
        sourceKind: resolveSourceKind(nextSourceContextItemId),
        isArchived: false,
      },
    );

    return updated ?? params.matchedRecord;
  }

  private async createRecord(params: {
    workflowRunId: string;
    input: NormalizedWorkflowRunTodoInput;
    index: number;
    scope: ExecutionContext;
  }): Promise<WorkflowRunTodo> {
    const sourceContextItemId = params.input.sourceContextItemId;

    return this.workflowRunTodoRepository.create({
      workflowRunId: params.workflowRunId,
      scopeId: getScopeId(params.scope),
      contextId: toUuidOrNull(getContextId(params.scope)),
      title: params.input.title ?? `Todo item ${String(params.index + 1)}`,
      status: params.input.status,
      orderIndex: params.index,
      sourceContextItemId,
      sourceKind: resolveSourceKind(sourceContextItemId),
      isArchived: false,
    });
  }

  private async buildResponse(
    workflowRunId: string,
    scope: ExecutionContext,
    records: WorkflowRunTodo[],
  ): Promise<WorkflowRunTodoResponse> {
    const todoList = records.map((record) =>
      toWorkflowRunTodoRecord(record as WorkflowRunTodoEntityLike),
    );

    const contextId = getContextId(scope);
    const sourceInfo = await this.resolveSourceInfo(contextId, records);

    return {
      workflow_run_id: workflowRunId,
      scope_id: getScopeId(scope),
      context_id: contextId,
      todo_list: todoList,
      summary: summarizeTodoList(todoList),
      source: sourceInfo,
      _markdown: this.formatWorkflowRunTodoListMarkdown({
        workflowRunId,
        contextId: contextId,
        items: todoList,
        source: sourceInfo,
      }),
    };
  }

  private async resolveSourceInfo(
    contextId: string | null,
    records: WorkflowRunTodo[],
  ): Promise<WorkflowRunTodoSourceInfo> {
    await Promise.resolve();
    const linkedRecords = collectLinkedRecords(records);
    const mode = resolveTodoSourceMode({
      linkedCount: linkedRecords.length,
      totalCount: records.length,
    });

    if (!contextId || linkedRecords.length === 0) {
      return {
        mode,
        has_drift: false,
        stale_count: 0,
      };
    }

    return {
      mode,
      has_drift: false,
      stale_count: 0,
    };
  }

  private async syncContextItemStatuses(
    contextId: string | null,
    statusByContextItemId: Map<string, WorkflowRunTodoStatus>,
  ): Promise<void> {
    await Promise.resolve();
    void contextId;
    void statusByContextItemId;
  }

  private async addAgentTodo(
    workflowRunId: string,
    text: string,
  ): Promise<TodoItem[]> {
    const existing =
      await this.workflowRunTodoRepository.findByWorkflowRunId(workflowRunId);

    await this.workflowRunTodoRepository.create({
      workflowRunId,
      scopeId: null,
      contextId: null,
      title: text,
      status: 'not-started',
      orderIndex: existing.length,
      sourceContextItemId: null,
      sourceKind: 'manual',
      isArchived: false,
    });

    return this.emitAndReturnAgentTodos(workflowRunId);
  }

  private async startAgentTodo(
    workflowRunId: string,
    id: number,
  ): Promise<TodoItem[]> {
    const records =
      await this.workflowRunTodoRepository.findByWorkflowRunId(workflowRunId);
    const orderIndex = id - 1;
    const target = records.find(
      (record) => record.orderIndex === orderIndex && !record.isArchived,
    );

    if (!target) {
      throw new BadRequestException(`Todo #${String(id)} not found`);
    }

    for (const record of records) {
      if (
        !record.isArchived &&
        record.status === 'in-progress' &&
        record.id !== target.id
      ) {
        await this.workflowRunTodoRepository.update(record.id, {
          status: 'not-started',
        });
      }
    }

    await this.workflowRunTodoRepository.update(target.id, {
      status: 'in-progress',
    });

    return this.emitAndReturnAgentTodos(workflowRunId);
  }

  private async completeAgentTodo(
    workflowRunId: string,
    id: number,
  ): Promise<TodoItem[]> {
    const records =
      await this.workflowRunTodoRepository.findByWorkflowRunId(workflowRunId);
    const orderIndex = id - 1;
    const target = records.find(
      (record) => record.orderIndex === orderIndex && !record.isArchived,
    );

    if (!target) {
      throw new BadRequestException(`Todo #${String(id)} not found`);
    }

    await this.workflowRunTodoRepository.update(target.id, {
      status: 'completed',
    });

    return this.emitAndReturnAgentTodos(workflowRunId);
  }

  private async listAgentTodos(workflowRunId: string): Promise<TodoItem[]> {
    const records =
      await this.workflowRunTodoRepository.findByWorkflowRunId(workflowRunId);

    return records
      .filter((record) => !record.isArchived)
      .map((record) => toTodoItem(record));
  }

  private async clearAgentTodos(workflowRunId: string): Promise<TodoItem[]> {
    const records =
      await this.workflowRunTodoRepository.findByWorkflowRunId(workflowRunId);

    for (const record of records) {
      if (!record.isArchived && record.status !== 'completed') {
        await this.workflowRunTodoRepository.update(record.id, {
          isArchived: true,
        });
      }
    }

    return this.emitAndReturnAgentTodos(workflowRunId);
  }

  private async emitAndReturnAgentTodos(
    workflowRunId: string,
  ): Promise<TodoItem[]> {
    const todos = await this.listAgentTodos(workflowRunId);

    await this.stepEventPublisher.publishProcessEvent(
      workflowRunId,
      'todo_state_updated',
      { todos },
    );

    return todos;
  }

  private async requireRun(workflowRunId: string) {
    const run = await this.workflowRunRepository.findById(workflowRunId);
    if (!run) {
      throw new NotFoundException(`Workflow run ${workflowRunId} not found`);
    }

    return run;
  }

  private formatWorkflowRunTodoListMarkdown(params: {
    workflowRunId: string;
    contextId: string | null;
    items: Array<{
      order_index: number;
      id: string;
      title: string;
      status: string;
      source_kind: string;
      source_context_item_id: string | null;
    }>;
    source: { mode: string; has_drift: boolean; stale_count: number };
  }): string {
    const header = [
      '# Run Todo List\n',
      `**Workflow Run ID:** \`${params.workflowRunId}\``,
      `**Context Item ID:** ${params.contextId ? `\`${params.contextId}\`` : '—'}`,
      `**Source Mode:** ${params.source.mode}`,
      `**Source Drift:** ${params.source.has_drift ? 'yes' : 'no'} (${String(params.source.stale_count)} stale)`,
      `**Total Items:** ${String(params.items.length)}`,
      '',
    ];

    if (params.items.length === 0) {
      return [...header, '_No todo items recorded for this run._'].join('\n');
    }

    const rows = [...params.items]
      .sort((left, right) => left.order_index - right.order_index)
      .map(
        (item) =>
          `| ${String(item.order_index)} | \`${item.id}\` | ${item.title} | ${item.status} | ${item.source_kind} | ${
            item.source_context_item_id
              ? `\`${item.source_context_item_id}\``
              : '—'
          } |`,
      );

    return [
      ...header,
      '| Order | Todo ID | Title | Status | Source | Context ID |',
      '|-------|---------|-------|--------|--------|------------|',
      ...rows,
    ].join('\n');
  }
}
