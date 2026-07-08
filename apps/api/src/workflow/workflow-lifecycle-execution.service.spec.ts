import { WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  IWorkflowDefinitionRepository,
  IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';
import { WorkflowLifecycleResultRepository } from './database/repositories/workflow-lifecycle-result.repository';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowLifecycleExecutionService } from './workflow-lifecycle-execution.service';
import { WorkflowTriggerRegistryService } from './workflow-trigger-registry.service';

describe('WorkflowLifecycleExecutionService', () => {
  const workflowRepository = {
    findActiveBySourceScope: vi.fn(),
  } as unknown as IWorkflowDefinitionRepository;
  const triggerRegistry = {
    resolveLifecycleBindings: vi.fn(),
  } as unknown as WorkflowTriggerRegistryService;
  const workflowEngine = {
    startWorkflow: vi.fn(),
  } as unknown as WorkflowEngineService;
  const workflowRunRepository = {
    findById: vi.fn(),
  } as unknown as IWorkflowRunRepository;
  const workflowLifecycleResultRepository = {
    save: vi.fn(),
  } as unknown as WorkflowLifecycleResultRepository;

  let service: WorkflowLifecycleExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workflowLifecycleResultRepository.save).mockResolvedValue({
      id: 'saved-id',
    });
    service = new WorkflowLifecycleExecutionService(
      workflowRepository,
      triggerRegistry,
      workflowEngine,
      workflowRunRepository,
      workflowLifecycleResultRepository,
    );
  });

  it('returns skipped without starting workflows when no lifecycle bindings match', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([]);

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
    });

    expect(workflowRepository.findActiveBySourceScope).toHaveBeenCalledWith(
      'repository',
      'scope-1',
    );
    expect(triggerRegistry.resolveLifecycleBindings).toHaveBeenCalledWith([], {
      phase: 'review',
      hook: 'before_transition',
      blockingOnly: false,
    });
    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(result).toEqual({
      id: 'saved-id',
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
      blockingOnly: false,
      status: 'skipped',
      results: [],
    });
  });

  it('starts a matching blocking workflow and returns passed when the run completes', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([
      { id: 'wf-row', is_active: true, yaml_definition: 'yaml' } as never,
    ]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding({ blocking: true }),
    ]);
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue('run-1');
    vi.mocked(workflowRunRepository.findById).mockResolvedValue({
      id: 'run-1',
      status: WorkflowStatus.COMPLETED,
    });

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      contextId: 'context-1',
      phase: 'review',
      hook: 'before_transition',
      blockingOnly: true,
      payload: { actor: 'agent-1' },
    });

    expect(triggerRegistry.resolveLifecycleBindings).toHaveBeenCalledWith(
      [{ id: 'wf-row', is_active: true, yaml_definition: 'yaml' }],
      {
        phase: 'review',
        hook: 'before_transition',
        blockingOnly: true,
      },
    );
    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith('wf-row', {
      actor: 'agent-1',
      scopeId: 'scope-1',
      contextId: 'context-1',
      phase: 'review',
      hook: 'before_transition',
      lifecycle: {
        phase: 'review',
        hook: 'before_transition',
        blocking: true,
      },
    });
    expect(result.status).toBe('passed');
    expect(result.results).toEqual([
      expect.objectContaining({
        workflowId: 'wf-row',
        workflowDefinitionId: 'workflow_lifecycle',
        workflowName: 'Lifecycle Workflow',
        phase: 'review',
        hook: 'before_transition',
        blocking: true,
        status: 'passed',
        runId: 'run-1',
      }),
    ]);
  });

  it.each([WorkflowStatus.FAILED, WorkflowStatus.CANCELLED])(
    'maps %s runs to failed',
    async (status) => {
      arrangeBindingStartAndRun(status);

      const result = await service.executeLifecycleWorkflows({
        scopeId: 'scope-1',
        phase: 'review',
        hook: 'before_transition',
      });

      expect(result.status).toBe('failed');
      expect(result.results[0].status).toBe('failed');
    },
  );

  it('skips a workflow without starting it when its condition evaluates false', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding({
        condition:
          "{{#if (eq trigger.contextId 'expected')}}true{{else}}false{{/if}}",
      }),
    ]);

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      contextId: 'actual',
      phase: 'review',
      hook: 'before_transition',
    });

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(result.status).toBe('skipped');
    expect(result.results[0]).toEqual(
      expect.objectContaining({ status: 'skipped' }),
    );
    expect(result.results[0]).not.toHaveProperty('runId');
  });

  it('returns skipped when workflow start returns null', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding(),
    ]);
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue(null);

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
    });

    expect(result.status).toBe('skipped');
    expect(result.results[0].status).toBe('skipped');
  });

  it('returns unavailable when workflow start throws', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding(),
    ]);
    vi.mocked(workflowEngine.startWorkflow).mockRejectedValue(
      new Error('engine unavailable'),
    );

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
    });

    expect(result.status).toBe('unavailable');
    expect(result.results[0]).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        error: 'engine unavailable',
      }),
    );
  });

  it('returns unavailable when the started run cannot be found', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding(),
    ]);
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue('run-1');
    vi.mocked(workflowRunRepository.findById).mockResolvedValue(null);

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
    });

    expect(result.status).toBe('unavailable');
    expect(result.results[0].status).toBe('unavailable');
  });

  it('returns timed_out when the run does not reach a terminal status before timeout', async () => {
    vi.useFakeTimers();
    try {
      arrangeBindingStartAndRun(WorkflowStatus.RUNNING);

      const pending = service.executeLifecycleWorkflows({
        scopeId: 'scope-1',
        phase: 'review',
        hook: 'before_transition',
        timeoutMs: 5,
        pollIntervalMs: 1,
      });

      await vi.advanceTimersByTimeAsync(10);
      const result = await pending;

      expect(result.status).toBe('timed_out');
      expect(result.results[0].status).toBe('timed_out');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not allow payload values to override reserved trigger fields', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding({ blocking: true }),
    ]);
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue(null);

    await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      contextId: 'context-1',
      phase: 'review',
      hook: 'before_transition',
      payload: {
        scopeId: 'payload-scope',
        contextId: 'payload-context',
        phase: 'payload-phase',
        hook: 'payload-hook',
        lifecycle: { phase: 'payload-phase' },
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'wf-row',
      expect.objectContaining({
        scopeId: 'scope-1',
        contextId: 'context-1',
        phase: 'review',
        hook: 'before_transition',
        lifecycle: {
          phase: 'review',
          hook: 'before_transition',
          blocking: true,
        },
      }),
    );
  });

  it('does not allow payload contextId when request contextId is omitted', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding({ blocking: true }),
    ]);
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue(null);

    await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
      payload: {
        actor: 'agent-1',
        contextId: 'payload-context',
        scopeId: 'payload-scope',
        phase: 'payload-phase',
        hook: 'payload-hook',
        lifecycle: { phase: 'payload-phase' },
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith('wf-row', {
      actor: 'agent-1',
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
      lifecycle: {
        phase: 'review',
        hook: 'before_transition',
        blocking: true,
      },
    });
  });

  it('does not pass zero poll intervals to sleep while timing out safely', async () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    arrangeBindingStartAndRun(WorkflowStatus.RUNNING);

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
      timeoutMs: 1,
      pollIntervalMs: 0,
    });

    const sleepIntervals = setTimeoutSpy.mock.calls.map((call) => call[1]);
    expect(sleepIntervals).not.toContain(0);
    expect(result.status).toBe('timed_out');

    setTimeoutSpy.mockRestore();
  });

  it('clamps positive poll intervals below the minimum', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    try {
      arrangeBindingStartAndRun(WorkflowStatus.RUNNING);

      const pending = service.executeLifecycleWorkflows({
        scopeId: 'scope-1',
        phase: 'review',
        hook: 'before_transition',
        timeoutMs: 60,
        pollIntervalMs: 10,
      });

      await vi.advanceTimersByTimeAsync(1);
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 50);

      await vi.advanceTimersByTimeAsync(60);
      await expect(pending).resolves.toMatchObject({ status: 'timed_out' });
    } finally {
      setTimeoutSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it('falls back to the default timeout for invalid non-positive timeout values', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue(
        [],
      );
      vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
        lifecycleBinding(),
      ]);
      vi.mocked(workflowEngine.startWorkflow).mockResolvedValue('run-1');
      vi.mocked(workflowRunRepository.findById)
        .mockResolvedValueOnce({
          id: 'run-1',
          status: WorkflowStatus.RUNNING,
        })
        .mockResolvedValueOnce({
          id: 'run-1',
          status: WorkflowStatus.COMPLETED,
        });

      const pending = service.executeLifecycleWorkflows({
        scopeId: 'scope-1',
        phase: 'review',
        hook: 'before_transition',
        timeoutMs: -1,
        pollIntervalMs: 1,
      });

      await vi.advanceTimersByTimeAsync(50);

      await expect(pending).resolves.toMatchObject({ status: 'passed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns unavailable when polling the started run throws', async () => {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding(),
    ]);
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue('run-1');
    vi.mocked(workflowRunRepository.findById).mockRejectedValue(
      new Error('run lookup unavailable'),
    );

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'scope-1',
      phase: 'review',
      hook: 'before_transition',
    });

    expect(result.status).toBe('unavailable');
    expect(result.results).toEqual([
      expect.objectContaining({
        status: 'unavailable',
        runId: 'run-1',
        error: 'run lookup unavailable',
      }),
    ]);
  });

  function arrangeBindingStartAndRun(status: WorkflowStatus): void {
    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([
      lifecycleBinding(),
    ]);
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue('run-1');
    vi.mocked(workflowRunRepository.findById).mockResolvedValue({
      id: 'run-1',
      status,
    });
  }

  describe('persistence', () => {
    it('persists the execution result via the repository and returns the saved id', async () => {
      vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue(
        [],
      );
      vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([]);
      vi.mocked(workflowLifecycleResultRepository.save).mockResolvedValue({
        id: 'persisted-1',
      });

      const result = await service.executeLifecycleWorkflows({
        scopeId: 'scope-1',
        contextId: 'context-1',
        phase: 'review',
        hook: 'before_transition',
        blockingOnly: true,
        repositoryRef: 'repo-1',
      });

      expect(workflowLifecycleResultRepository.save).toHaveBeenCalledWith({
        scope_id: 'scope-1',
        context_id: 'context-1',
        phase: 'review',
        hook: 'before_transition',
        blocking_only: true,
        aggregate_status: 'skipped',
        results: [],
        repository_ref: 'repo-1',
      });
      expect(result.id).toBe('persisted-1');
    });

    it('persists null context_id and repository_ref when optional fields are omitted', async () => {
      vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue(
        [],
      );
      vi.mocked(triggerRegistry.resolveLifecycleBindings).mockReturnValue([]);
      vi.mocked(workflowLifecycleResultRepository.save).mockResolvedValue({
        id: 'persisted-2',
      });

      const result = await service.executeLifecycleWorkflows({
        scopeId: 'scope-2',
        phase: 'deployment',
        hook: 'after_transition',
      });

      expect(workflowLifecycleResultRepository.save).toHaveBeenCalledWith({
        scope_id: 'scope-2',
        context_id: null,
        phase: 'deployment',
        hook: 'after_transition',
        blocking_only: false,
        aggregate_status: 'skipped',
        results: [],
        repository_ref: null,
      });
      expect(result.id).toBe('persisted-2');
    });
  });

  function lifecycleBinding(overrides: Record<string, unknown> = {}) {
    return {
      workflowId: 'wf-row',
      workflowName: 'Lifecycle Workflow',
      workflowDefinitionId: 'workflow_lifecycle',
      triggerName: 'review.before_transition',
      triggerType: 'lifecycle',
      bindingSource: 'workflow_row',
      phase: 'review',
      hook: 'before_transition',
      blocking: false,
      ...overrides,
    } as never;
  }
});

describe('WorkflowLifecycleExecutionService — phase aliases', () => {
  const workflowRepository = {
    findActiveBySourceScope: vi.fn(),
  } as unknown as IWorkflowDefinitionRepository;
  const triggerRegistry = {
    resolveLifecycleBindings: vi.fn(),
  } as unknown as WorkflowTriggerRegistryService;
  const workflowEngine = {
    startWorkflow: vi.fn(),
  } as unknown as WorkflowEngineService;
  const workflowRunRepository = {
    findById: vi.fn(),
  } as unknown as IWorkflowRunRepository;
  const workflowLifecycleResultRepository = {
    save: vi.fn(),
  } as unknown as WorkflowLifecycleResultRepository;

  let service: WorkflowLifecycleExecutionService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(workflowLifecycleResultRepository.save).mockResolvedValue({
      id: 'lr-1',
    });
    service = new WorkflowLifecycleExecutionService(
      workflowRepository,
      triggerRegistry,
      workflowEngine,
      workflowRunRepository,
      workflowLifecycleResultRepository,
    );
  });

  it('finds a legacy phase:"merge" workflow when phase:"ready-to-merge" is requested', async () => {
    const legacyBinding = {
      workflowId: 'wf-legacy',
      workflowDefinitionId: 'pre_merge_ci',
      workflowName: 'Pre-Merge CI',
      phase: 'merge',
      hook: 'before',
      blocking: true,
    };

    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([
      { id: 'wf-row' } as never,
    ]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockImplementation(
      (_wfs: unknown, opts: { phase: string }) => {
        if (opts.phase === 'merge') {
          return [legacyBinding] as never;
        }
        return [];
      },
    );
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue('run-1');
    vi.mocked(workflowRunRepository.findById).mockResolvedValue({
      id: 'run-1',
      status: 'COMPLETED',
    });

    const result = await service.executeLifecycleWorkflows({
      scopeId: 'proj-1',
      contextId: 'wi-1',
      phase: 'ready-to-merge',
      hook: 'before',
      blockingOnly: true,
    });

    expect(triggerRegistry.resolveLifecycleBindings).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ phase: 'merge' }),
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0].workflowName).toBe('Pre-Merge CI');
  });

  it('does NOT duplicate bindings that appear under both the canonical and alias phase', async () => {
    const binding = {
      workflowId: 'wf-1',
      workflowDefinitionId: 'pre_merge_ci',
      workflowName: 'CI',
      phase: 'ready-to-merge',
      hook: 'before',
      blocking: true,
    };

    vi.mocked(workflowRepository.findActiveBySourceScope).mockResolvedValue([
      { id: 'wf-row' } as never,
    ]);
    vi.mocked(triggerRegistry.resolveLifecycleBindings).mockImplementation(
      (_wfs: unknown, opts: { phase: string }) => {
        if (opts.phase === 'ready-to-merge' || opts.phase === 'merge') {
          return [binding] as never;
        }
        return [];
      },
    );
    vi.mocked(workflowEngine.startWorkflow).mockResolvedValue('run-1');
    vi.mocked(workflowRunRepository.findById).mockResolvedValue({
      id: 'run-1',
      status: 'COMPLETED',
    });

    await service.executeLifecycleWorkflows({
      scopeId: 'proj-1',
      contextId: 'wi-1',
      phase: 'ready-to-merge',
      hook: 'before',
      blockingOnly: true,
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledTimes(1);
  });
});
