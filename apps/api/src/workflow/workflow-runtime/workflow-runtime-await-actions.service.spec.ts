import { BadRequestException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowRuntimeAwaitActionsService } from './workflow-runtime-await-actions.service';
import type { ChatSessionDomainPort } from '../domain-ports';

describe('WorkflowRuntimeAwaitActionsService', () => {
  let workflowEngine: { startWorkflow: ReturnType<typeof vi.fn> };
  let workflowPersistence: { getWorkflowRun: ReturnType<typeof vi.fn> };
  let awaitRegistry: { register: ReturnType<typeof vi.fn> };
  let sessionHydration: Pick<
    ChatSessionDomainPort,
    'findSessionTreeByWorkflowRunId'
  >;
  let harnessRegistry: { resolve: ReturnType<typeof vi.fn> };
  let scopedDefaults: { resolve: ReturnType<typeof vi.fn> };
  let runnerConfigStore: { get: ReturnType<typeof vi.fn> };
  let circuitBreaker: { evaluate: ReturnType<typeof vi.fn> };
  let service: WorkflowRuntimeAwaitActionsService;

  beforeEach(() => {
    workflowEngine = {
      startWorkflow: vi.fn().mockResolvedValue('child-run-1'),
    };
    workflowPersistence = {
      getWorkflowRun: vi.fn().mockResolvedValue({
        state_variables: { trigger: { scopeId: 'scope-1' } },
      }),
      getWorkflow: vi.fn().mockResolvedValue({ id: 'wf-def-1' }),
    };
    awaitRegistry = {
      register: vi.fn().mockResolvedValue({ id: 'await-1' }),
    };
    sessionHydration = {
      findSessionTreeByWorkflowRunId: vi
        .fn()
        .mockResolvedValue({ id: 'session-tree-1' }),
    };
    harnessRegistry = {
      resolve: vi
        .fn()
        .mockReturnValue({ capabilities: { supportsResume: true } }),
    };
    scopedDefaults = {
      resolve: vi.fn().mockResolvedValue({ harnessId: 'pi' }),
    };
    // Default: no runner config in Redis — gate falls back to scope defaults.
    runnerConfigStore = {
      get: vi.fn().mockResolvedValue(null),
    };
    // Default: circuit closed.
    circuitBreaker = {
      evaluate: vi.fn().mockResolvedValue({
        open: false,
        failureClass: 'tool_contract_mismatch',
        occurrences: 0,
        threshold: 3,
      }),
    };
    service = new WorkflowRuntimeAwaitActionsService(
      workflowEngine as never,
      workflowPersistence as never,
      awaitRegistry as never,
      sessionHydration as never,
      harnessRegistry as never,
      scopedDefaults as never,
      runnerConfigStore as never,
      circuitBreaker as never,
    );
  });

  afterEach(() => {
    delete process.env.ORCHESTRATION_AWAIT_ENABLED;
  });

  it('rejects and starts no children when ORCHESTRATION_AWAIT_ENABLED is false', async () => {
    process.env.ORCHESTRATION_AWAIT_ENABLED = 'false';

    await expect(
      service.startAwaitedInvocationWorkflows({
        workflow_run_id: 'parent-run-1',
        step_id: 'await-step',
        workflow_id: 'orchestration_invoke_agent_default',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(awaitRegistry.register).not.toHaveBeenCalled();
  });

  it('remains enabled by default when ORCHESTRATION_AWAIT_ENABLED is unset', async () => {
    delete process.env.ORCHESTRATION_AWAIT_ENABLED;

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalled();
    expect(awaitRegistry.register).toHaveBeenCalled();
  });

  it('rejects a call with no launch target and no awaited run ids', async () => {
    await expect(
      service.startAwaitedInvocationWorkflows({
        workflow_run_id: 'parent-run-1',
        step_id: 'await-step',
        reason: 'no target supplied',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(awaitRegistry.register).not.toHaveBeenCalled();
  });

  it('attaches to an existing run id without launching a new child', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      status: 'running',
      state_variables: { trigger: { scopeId: 'scope-1' } },
    });

    const result = await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      awaited_run_ids: ['child-9'],
    });

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(awaitRegistry.register).toHaveBeenCalledWith(
      expect.objectContaining({ awaitedRunIds: ['child-9'] }),
    );
    expect(result.executionStatus).toBe('suspended');
    expect(result.awaitedRunIds).toEqual(['child-9']);
  });

  it('rejects an attach to an unknown run id and starts no children', async () => {
    // Parent scope resolution tolerates a null run (scope simply unresolved);
    // the attach validation then rejects the missing target run.
    workflowPersistence.getWorkflowRun.mockResolvedValue(null);

    await expect(
      service.startAwaitedInvocationWorkflows({
        workflow_run_id: 'parent-run-1',
        step_id: 'await-step',
        awaited_run_ids: ['ghost-run'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(awaitRegistry.register).not.toHaveBeenCalled();
  });

  it('rejects an attach to a terminal run id', async () => {
    // Parent status is not validated (only attach targets are), so a terminal
    // run returned for every lookup exercises the terminal-target rejection.
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      status: 'completed',
      state_variables: { trigger: { scopeId: 'scope-1' } },
    });

    await expect(
      service.startAwaitedInvocationWorkflows({
        workflow_run_id: 'parent-run-1',
        step_id: 'await-step',
        awaited_run_ids: ['done-run'],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(awaitRegistry.register).not.toHaveBeenCalled();
  });

  it('refuses to launch and starts no children when the delegation circuit is open', async () => {
    circuitBreaker.evaluate.mockResolvedValue({
      open: true,
      failureClass: 'tool_contract_mismatch',
      occurrences: 4,
      threshold: 3,
    });

    await expect(
      service.startAwaitedInvocationWorkflows({
        workflow_run_id: 'parent-run-1',
        step_id: 'await-step',
        workflow_id: 'project_goal_backlog_planning',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(circuitBreaker.evaluate).toHaveBeenCalledWith('wf-def-1');
    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(awaitRegistry.register).not.toHaveBeenCalled();
  });

  it('proceeds when the delegation circuit is closed', async () => {
    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'project_goal_backlog_planning',
    });

    expect(circuitBreaker.evaluate).toHaveBeenCalledWith('wf-def-1');
    expect(workflowEngine.startWorkflow).toHaveBeenCalled();
    expect(awaitRegistry.register).toHaveBeenCalled();
  });

  it('throws and starts no children when the calling engine cannot resume', async () => {
    harnessRegistry.resolve.mockReturnValue({
      capabilities: { supportsResume: false },
    });

    await expect(
      service.startAwaitedInvocationWorkflows({
        workflow_run_id: 'parent-run-1',
        step_id: 'await-step',
        workflow_id: 'orchestration_invoke_agent_default',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(awaitRegistry.register).not.toHaveBeenCalled();
  });

  it('requires the calling run and step identifiers', async () => {
    await expect(
      service.startAwaitedInvocationWorkflows({
        workflow_id: 'orchestration_invoke_agent_default',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });

  it('starts each requested child with the parent link recorded', async () => {
    workflowEngine.startWorkflow
      .mockResolvedValueOnce('child-run-a')
      .mockResolvedValueOnce('child-run-b');

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflows: [
        {
          workflow_id: 'workflow_alpha',
          agent_profile: 'architect-agent',
          objective: 'Investigate module A.',
        },
        { workflow_id: 'workflow_beta', inputs: { focus: 'module B' } },
      ],
    });

    expect(workflowEngine.startWorkflow).toHaveBeenNthCalledWith(
      1,
      'workflow_alpha',
      expect.objectContaining({
        parentWorkflowRunId: 'parent-run-1',
        parentStepId: 'await-step',
        agent_profile: 'architect-agent',
        objective: 'Investigate module A.',
      }),
    );
    expect(workflowEngine.startWorkflow).toHaveBeenNthCalledWith(
      2,
      'workflow_beta',
      expect.objectContaining({
        parentWorkflowRunId: 'parent-run-1',
        parentStepId: 'await-step',
        focus: 'module B',
      }),
    );
  });

  it('injects the parent run scope into each child trigger payload', async () => {
    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
      inputs: { goals: ['Goal A'] },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'workflow_alpha',
      expect.objectContaining({
        parentWorkflowRunId: 'parent-run-1',
        parentStepId: 'await-step',
        goals: ['Goal A'],
        scope_id: 'scope-1',
        scopeId: 'scope-1',
      }),
    );
  });

  it('does not override a scope explicitly provided in the child inputs', async () => {
    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
      inputs: { scopeId: 'explicit-scope', scope_id: 'explicit-scope' },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'workflow_alpha',
      expect.objectContaining({
        scope_id: 'explicit-scope',
        scopeId: 'explicit-scope',
      }),
    );
  });

  it('inherits the parent run basePath and repositoryUrl into each child trigger payload', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: 'scope-1',
          basePath: '/data/nexus-workspaces/clones/scope-1',
          repositoryUrl: 'https://github.com/example/repo',
        },
      },
    });

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
      inputs: { goals: ['Goal A'] },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'workflow_alpha',
      expect.objectContaining({
        basePath: '/data/nexus-workspaces/clones/scope-1',
        repositoryUrl: 'https://github.com/example/repo',
      }),
    );
  });

  it('does not override basePath explicitly provided in the child inputs', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: 'scope-1',
          basePath: '/data/nexus-workspaces/clones/scope-1',
        },
      },
    });

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
      inputs: { basePath: '/explicit/workspace' },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'workflow_alpha',
      expect.objectContaining({ basePath: '/explicit/workspace' }),
    );
  });

  it('infers the child basePath from scope and repositoryUrl when the parent trigger has none', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: 'scope-1',
          repositoryUrl: 'https://github.com/example/repo',
        },
      },
    });

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
      inputs: {},
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'workflow_alpha',
      expect.objectContaining({
        basePath: '/data/nexus-workspaces/clones/scope-1',
      }),
    );
  });

  it('registers the durable await with the started child run ids', async () => {
    workflowEngine.startWorkflow
      .mockResolvedValueOnce('child-run-a')
      .mockResolvedValueOnce('child-run-b');

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflows: [
        { workflow_id: 'workflow_alpha' },
        { workflow_id: 'workflow_beta' },
      ],
    });

    expect(
      sessionHydration.findSessionTreeByWorkflowRunId,
    ).toHaveBeenCalledWith('parent-run-1');
    expect(awaitRegistry.register).toHaveBeenCalledWith({
      parentRunId: 'parent-run-1',
      parentStepId: 'await-step',
      parentSessionTreeId: 'session-tree-1',
      awaitedRunIds: ['child-run-a', 'child-run-b'],
    });
  });

  it('passes a null parent session tree id through when none exists yet', async () => {
    sessionHydration.findSessionTreeByWorkflowRunId.mockResolvedValue(null);

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
    });

    expect(awaitRegistry.register).toHaveBeenCalledWith(
      expect.objectContaining({ parentSessionTreeId: null }),
    );
  });

  it('returns a suspended envelope carrying the await id and child run ids', async () => {
    workflowEngine.startWorkflow
      .mockResolvedValueOnce('child-run-a')
      .mockResolvedValueOnce('child-run-b');
    awaitRegistry.register.mockResolvedValue({ id: 'await-99' });

    const result = await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflows: [
        { workflow_id: 'workflow_alpha' },
        { workflow_id: 'workflow_beta' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      requestedAction: 'await_agent_workflow',
      executionStatus: 'suspended',
      awaitId: 'await-99',
      awaitedRunIds: ['child-run-a', 'child-run-b'],
    });
  });

  it('resolves the calling run harness from its trigger scope defaults', async () => {
    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
    });

    expect(workflowPersistence.getWorkflowRun).toHaveBeenCalledWith(
      'parent-run-1',
    );
    expect(scopedDefaults.resolve).toHaveBeenCalledWith('scope-1');
    expect(harnessRegistry.resolve).toHaveBeenCalledWith('pi');
  });

  it('uses the per-step runner config harness id when one exists in Redis', async () => {
    runnerConfigStore.get.mockResolvedValue({ harnessId: 'claude-code' });

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
    });

    expect(runnerConfigStore.get).toHaveBeenCalledWith(
      'parent-run-1',
      'await-step',
    );
    // Harness id sourced from the stored runner config, not scope defaults
    expect(harnessRegistry.resolve).toHaveBeenCalledWith('claude-code');
    // Scope defaults not consulted when runner config is present
    expect(scopedDefaults.resolve).not.toHaveBeenCalled();
  });

  it('rejects when per-step runner config carries a non-resume-capable harness', async () => {
    runnerConfigStore.get.mockResolvedValue({
      harnessId: 'some-future-harness',
    });
    harnessRegistry.resolve.mockReturnValue({
      capabilities: { supportsResume: false },
    });

    await expect(
      service.startAwaitedInvocationWorkflows({
        workflow_run_id: 'parent-run-1',
        step_id: 'await-step',
        workflow_id: 'workflow_alpha',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });

  it('falls back to scope-default harness when no runner config is in Redis', async () => {
    runnerConfigStore.get.mockResolvedValue(null);

    await service.startAwaitedInvocationWorkflows({
      workflow_run_id: 'parent-run-1',
      step_id: 'await-step',
      workflow_id: 'workflow_alpha',
    });

    expect(scopedDefaults.resolve).toHaveBeenCalled();
    expect(harnessRegistry.resolve).toHaveBeenCalledWith('pi');
  });
});
