import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowLifecycleController } from './workflow-lifecycle.controller';
import { WorkflowLifecycleExecutionService } from './workflow-lifecycle-execution.service';
import { WorkflowLifecycleResultRepository } from './database/repositories/workflow-lifecycle-result.repository';
import type {
  LifecycleResultsQueryRequest,
  WorkflowLifecycleExecutionRequest,
  WorkflowLifecycleExecutionResult,
} from '@nexus/core';

describe('WorkflowLifecycleController', () => {
  let controller: WorkflowLifecycleController;

  const mockResult: WorkflowLifecycleExecutionResult = {
    id: 'result-1',
    scopeId: 'scope-1',
    contextId: 'ctx-1',
    phase: 'merge',
    hook: 'before',
    blockingOnly: true,
    status: 'passed',
    results: [],
  };

  const executeLifecycleWorkflows = vi.fn().mockResolvedValue(mockResult);

  const lifecycleService = {
    executeLifecycleWorkflows,
  } as unknown as WorkflowLifecycleExecutionService;

  const findFiltered = vi.fn().mockResolvedValue([]);

  const lifecycleResultRepository = {
    findFiltered,
  } as unknown as WorkflowLifecycleResultRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new WorkflowLifecycleController(
      lifecycleService,
      lifecycleResultRepository,
    );
  });

  it('calls the lifecycle execution service with the request body and returns the result', async () => {
    const request: WorkflowLifecycleExecutionRequest = {
      scopeId: 'scope-1',
      contextId: 'ctx-1',
      phase: 'merge',
      hook: 'before',
      blockingOnly: true,
    };

    const result = await controller.execute(request);

    expect(executeLifecycleWorkflows).toHaveBeenCalledWith(request);
    expect(result).toEqual(mockResult);
  });

  it('returns lifecycle results filtered by scope and context', async () => {
    const query: LifecycleResultsQueryRequest = {
      scopeId: 'scope-1',
      contextId: 'ctx-1',
      phase: 'review',
      hook: 'before_transition',
    };

    const result = await controller.getResults(query);

    expect(findFiltered).toHaveBeenCalledWith(query);
    expect(result).toEqual({ success: true, data: [] });
  });
});
