import { NotFoundException } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { WorkflowRuntimeOrchestrationActionsService } from './workflow-runtime-orchestration-actions.service';

const DEFAULT_SCOPE_ID = '70945876-acf1-4ec4-bd7b-ea0121f90140';

function shortSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function invocationFingerprint(
  value: string | null | undefined,
  workflowId = 'orchestration_invoke_agent_default',
): string {
  return shortSha256(value?.trim() || workflowId);
}

describe('WorkflowRuntimeOrchestrationActionsService', () => {
  let workflowEngine: {
    startWorkflow: ReturnType<typeof vi.fn>;
  };
  let workflowPersistence: {
    getWorkflowRun: ReturnType<typeof vi.fn>;
    getWorkflow: ReturnType<typeof vi.fn>;
  };
  let circuitBreaker: { evaluate: ReturnType<typeof vi.fn> };
  let service: WorkflowRuntimeOrchestrationActionsService;
  let originalWorkspaceBasePath: string | undefined;

  beforeEach(() => {
    workflowEngine = {
      startWorkflow: vi.fn().mockResolvedValue('child-run-1'),
    };
    workflowPersistence = {
      getWorkflowRun: vi.fn().mockResolvedValue({
        state_variables: {
          trigger: {
            scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
          },
        },
      }),
      getWorkflow: vi.fn().mockResolvedValue({ id: 'wf-def-1' }),
    };
    circuitBreaker = {
      evaluate: vi.fn().mockResolvedValue({
        open: false,
        failureClass: 'tool_contract_mismatch',
        occurrences: 0,
        threshold: 3,
      }),
    };
    service = new WorkflowRuntimeOrchestrationActionsService(
      workflowEngine as never,
      workflowPersistence as never,
      circuitBreaker as never,
    );
    originalWorkspaceBasePath = process.env.NEXUS_WORKSPACE_BASE_PATH;
    process.env.NEXUS_WORKSPACE_BASE_PATH = '/data/nexus-workspaces';
  });

  afterEach(() => {
    if (originalWorkspaceBasePath === undefined) {
      delete process.env.NEXUS_WORKSPACE_BASE_PATH;
      return;
    }

    process.env.NEXUS_WORKSPACE_BASE_PATH = originalWorkspaceBasePath;
  });

  it('skips the launch and starts no workflow when the delegation circuit is open', async () => {
    circuitBreaker.evaluate.mockResolvedValue({
      open: true,
      failureClass: 'tool_contract_mismatch',
      occurrences: 5,
      threshold: 3,
    });

    const result = await service.invokeAgentWorkflow({
      workflow_id: 'project_goal_backlog_planning',
      reason: 'backlog planning',
      trigger_data: { scopeId: DEFAULT_SCOPE_ID },
    });

    expect(circuitBreaker.evaluate).toHaveBeenCalledWith('wf-def-1');
    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        execution_status: 'skipped_circuit_open',
        error_code: 'delegation_circuit_open',
      }),
    );
  });

  it('starts the default agent invocation workflow with opaque caller context', async () => {
    const result = await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      task_prompt: 'Draft missing PRDs.',
      reason: 'Spec generation required.',
      context: {
        type: 'project',
        id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      },
      trigger_data: {
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      {
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        scope_id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        context: {
          type: 'project',
          id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        },
        dedupeKey: `invoke-agent:${DEFAULT_SCOPE_ID}:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Spec generation required.')}`,
        agent_profile: 'product-manager',
        task_prompt: 'Draft missing PRDs.',
        objective: 'Draft missing PRDs.',
        reason: 'Spec generation required.',
        reasoning: 'Spec generation required.',
      },
    );
    expect(result).toEqual({
      ok: true,
      requested_action: 'invoke_agent_workflow',
      mode_evaluation: 'allow',
      execution_status: 'executed',
      correlation_id: expect.any(String),
      action_request_id: null,
      recommendation: undefined,
      authority_source: null,
      error: undefined,
      run_id: 'child-run-1',
      workflow_run_id: 'child-run-1',
      already_active: false,
      was_launched: true,
      agent_profile_actual: 'product-manager',
    });
  });

  it('reports concurrency skips as already active instead of opaque failures', async () => {
    workflowEngine.startWorkflow.mockResolvedValue(null);

    const result = await service.invokeAgentWorkflow({
      workflow_id: 'project_spec_revision_ceo',
      workflow_run_id: 'parent-run-1',
      agent_profile: 'architect-agent',
      reason: 'imported-repo-reconciliation',
      scopeId: 'project-1',
    });

    expect(result).toMatchObject({
      ok: false,
      requested_action: 'invoke_agent_workflow',
      mode_evaluation: 'allow',
      execution_status: 'skipped_due_concurrency',
      run_id: null,
      workflow_run_id: null,
      already_active: true,
      was_launched: false,
      agent_profile_actual: 'architect-agent',
      error_code: 'workflow_concurrency_skip',
      error_message: expect.stringContaining('skipped by concurrency policy'),
      error: expect.stringContaining('do not retry immediately'),
    });
  });

  it('reports missing workflow identifiers with an actionable error', async () => {
    workflowEngine.startWorkflow.mockRejectedValue(
      new NotFoundException('Workflow nope not found'),
    );

    const result = await service.invokeAgentWorkflow({
      workflow_id: 'nope',
      agent_profile: 'product-manager',
      task_prompt: 'Review PRD',
    });

    expect(result).toMatchObject({
      ok: false,
      requested_action: 'invoke_agent_workflow',
      mode_evaluation: 'allow',
      execution_status: 'invalid_workflow',
      run_id: null,
      workflow_run_id: null,
      was_launched: false,
      requested_workflow_id: 'nope',
      error_code: 'workflow_not_found',
      error_message: expect.stringContaining(
        'Workflow "nope" could not be found',
      ),
    });
  });

  it('reports status-shaped 404 workflow start errors as invalid workflow', async () => {
    workflowEngine.startWorkflow.mockRejectedValue({
      response: {
        statusCode: 404,
        message: 'Workflow missing-workflow not found',
      },
    });

    const result = await service.invokeAgentWorkflow({
      workflow_id: 'missing-workflow',
      agent_profile: 'product-manager',
    });

    expect(result).toMatchObject({
      ok: false,
      execution_status: 'invalid_workflow',
      was_launched: false,
      requested_workflow_id: 'missing-workflow',
      error_code: 'workflow_not_found',
    });
  });

  it('rethrows unrelated status-shaped 404 workflow start errors', async () => {
    const unrelatedNotFoundError = {
      status: 404,
      message: 'Project project-1 not found',
    };
    workflowEngine.startWorkflow.mockRejectedValue(unrelatedNotFoundError);

    await expect(
      service.invokeAgentWorkflow({
        workflow_id: 'missing-workflow',
        agent_profile: 'product-manager',
      }),
    ).rejects.toBe(unrelatedNotFoundError);
  });

  it('rethrows workflow 404 errors when the requested workflow id is only a substring', async () => {
    const unrelatedWorkflowNotFoundError = {
      status: 404,
      message: 'Workflow workflow-alpha not found',
    };
    workflowEngine.startWorkflow.mockRejectedValue(
      unrelatedWorkflowNotFoundError,
    );

    await expect(
      service.invokeAgentWorkflow({
        workflow_id: 'flow',
        agent_profile: 'product-manager',
      }),
    ).rejects.toBe(unrelatedWorkflowNotFoundError);
  });

  it('rethrows unexpected workflow start errors', async () => {
    const unexpectedError = new Error('database unavailable');
    workflowEngine.startWorkflow.mockRejectedValue(unexpectedError);

    await expect(
      service.invokeAgentWorkflow({
        workflow_id: 'project_spec_revision_ceo',
        agent_profile: 'architect-agent',
      }),
    ).rejects.toThrow(unexpectedError);
  });

  it('adds a deterministic dedupe key for delegated agent workflow launches', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      id: 'parent-run-1',
      state_variables: { trigger: { scopeId: 'project-1' } },
    });
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      task_prompt: 'Review PRD for imported repo',
      reason: 'imported-repo-reconciliation',
      workflow_run_id: 'parent-run-1',
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        dedupeKey: expect.stringMatching(
          /^invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:/,
        ),
      }),
    );
    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        dedupeKey: `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('imported-repo-reconciliation')}`,
      }),
    );
  });

  it('uses non-UUID trigger scope IDs in default delegated invocation dedupe keys', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      task_prompt: 'Review imported project state',
      trigger_data: {
        scopeId: 'imported-project-alpha',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        dedupeKey: `invoke-agent:imported-project-alpha:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Review imported project state')}`,
      }),
    );
  });

  it('preserves top-level non-UUID scope IDs in delegated trigger data and dedupe keys', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      scopeId: 'imported-project-alpha',
      task_prompt: 'Review imported project state',
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        scopeId: 'imported-project-alpha',
        dedupeKey: `invoke-agent:imported-project-alpha:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Review imported project state')}`,
      }),
    );
  });

  it.each([
    [
      'top-level camelCase',
      { dedupeKey: 'caller-camel-dedupe-key' },
      'caller-camel-dedupe-key',
    ],
    [
      'top-level snake_case',
      { dedupe_key: 'caller-snake-dedupe-key' },
      'caller-snake-dedupe-key',
    ],
    [
      'trigger camelCase',
      { trigger_data: { dedupeKey: 'trigger-camel-dedupe-key' } },
      'trigger-camel-dedupe-key',
    ],
    [
      'trigger snake_case',
      { trigger_data: { dedupe_key: 'trigger-snake-dedupe-key' } },
      'trigger-snake-dedupe-key',
    ],
  ])(
    'preserves caller-provided %s dedupe keys',
    async (_caseName, params, expectedDedupeKey) => {
      await service.invokeAgentWorkflow({
        agent_profile: 'product-manager',
        task_prompt: 'Draft missing PRDs.',
        ...params,
      });

      expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
        'orchestration_invoke_agent_default',
        expect.objectContaining({
          dedupeKey: expectedDedupeKey,
        }),
      );
    },
  );

  it('uses reason ahead of task prompt in delegated dedupe fingerprints', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      reason: 'Spec generation required.',
      task_prompt: 'Draft product requirements.',
      workflow_run_id: 'parent-run-1',
    });
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      reason: 'Spec generation required.',
      task_prompt: 'Review implementation plan.',
      workflow_run_id: 'parent-run-1',
    });

    const firstTrigger = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    const secondTrigger = workflowEngine.startWorkflow.mock.calls[1]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(firstTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Spec generation required.')}`,
    );
    expect(secondTrigger?.dedupeKey).toBe(firstTrigger?.dedupeKey);
  });

  it('uses trigger objective to avoid delegated dedupe collisions without task prompt or reason', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      trigger_data: {
        objective: 'Draft product requirements.',
      },
    });
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      trigger_data: {
        objective: 'Review implementation plan.',
      },
    });

    const firstTrigger = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    const secondTrigger = workflowEngine.startWorkflow.mock.calls[1]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(firstTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Draft product requirements.')}`,
    );
    expect(secondTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Review implementation plan.')}`,
    );
    expect(firstTrigger?.dedupeKey).not.toBe(secondTrigger?.dedupeKey);
  });

  it('uses top-level objective to avoid delegated dedupe collisions without task prompt or reason', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      objective: 'Draft product requirements.',
    });
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      objective: 'Review implementation plan.',
    });

    const firstTrigger = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    const secondTrigger = workflowEngine.startWorkflow.mock.calls[1]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(firstTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Draft product requirements.')}`,
    );
    expect(secondTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Review implementation plan.')}`,
    );
    expect(firstTrigger?.dedupeKey).not.toBe(secondTrigger?.dedupeKey);
  });

  it('preserves explicit trigger objective when top-level task prompt is provided', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      task_prompt: 'Draft task prompt.',
      trigger_data: {
        objective: 'Explicit trigger objective.',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        task_prompt: 'Draft task prompt.',
        objective: 'Explicit trigger objective.',
      }),
    );
  });

  it('preserves top-level objective when trigger objective is blank', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      objective: 'Top-level objective.',
      trigger_data: {
        objective: '   ',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        objective: 'Top-level objective.',
      }),
    );
  });

  it('keeps explicit trigger objective ahead of synthesized task prompt objective', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      task_prompt: 'Draft task prompt.',
      trigger_data: {
        objective: 'Explicit trigger objective.',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        task_prompt: 'Draft task prompt.',
        objective: 'Explicit trigger objective.',
      }),
    );
  });

  it('uses caller message to avoid delegated dedupe collisions without task prompt or reason', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      message: 'Draft product requirements.',
    });
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      message: 'Review implementation plan.',
    });

    const firstTrigger = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    const secondTrigger = workflowEngine.startWorkflow.mock.calls[1]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(firstTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Draft product requirements.')}`,
    );
    expect(secondTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Review implementation plan.')}`,
    );
    expect(firstTrigger?.dedupeKey).not.toBe(secondTrigger?.dedupeKey);
  });

  it('uses trigger message to avoid delegated dedupe collisions without task prompt or reason', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      trigger_data: {
        message: 'Draft product requirements.',
      },
    });
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      trigger_data: {
        message: 'Review implementation plan.',
      },
    });

    const firstTrigger = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    const secondTrigger = workflowEngine.startWorkflow.mock.calls[1]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(firstTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Draft product requirements.')}`,
    );
    expect(secondTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Review implementation plan.')}`,
    );
    expect(firstTrigger?.dedupeKey).not.toBe(secondTrigger?.dedupeKey);
  });

  it('preserves top-level message when trigger message is blank', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      message: 'Top-level message.',
      trigger_data: {
        message: '   ',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        message: 'Top-level message.',
      }),
    );
  });

  it('uses trigger task_prompt when deriving delegated invocation dedupe keys', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      trigger_data: {
        task_prompt: 'Draft product requirements.',
      },
    });
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      workflow_run_id: 'parent-run-1',
      trigger_data: {
        task_prompt: 'Review implementation plan.',
      },
    });

    const firstTrigger = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    const secondTrigger = workflowEngine.startWorkflow.mock.calls[1]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(firstTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Draft product requirements.')}`,
    );
    expect(secondTrigger?.dedupeKey).toBe(
      `invoke-agent:parent-run-1:orchestration_invoke_agent_default:product-manager:${invocationFingerprint('Review implementation plan.')}`,
    );
    expect(firstTrigger?.dedupeKey).not.toBe(secondTrigger?.dedupeKey);
  });

  it('does not preserve blank trigger task prompts in delegated trigger data', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      trigger_data: {
        task_prompt: '   ',
      },
    });

    const triggerData = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(triggerData).not.toHaveProperty('task_prompt');
  });

  it('preserves trigger-provided dedupe keys when no top-level key is supplied', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      trigger_data: {
        dedupeKey: 'trigger-camel-dedupe-key',
        dedupe_key: 'trigger-snake-dedupe-key',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        dedupeKey: 'trigger-camel-dedupe-key',
      }),
    );
  });

  it('uses trigger snake_case dedupe key when no higher-precedence key is supplied', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      trigger_data: {
        dedupe_key: 'trigger-snake-dedupe-key',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        dedupeKey: 'trigger-snake-dedupe-key',
      }),
    );
  });

  it('falls through blank higher-precedence dedupe keys', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      dedupeKey: '   ',
      dedupe_key: 'caller-snake-dedupe-key',
      trigger_data: {
        dedupeKey: 'trigger-camel-dedupe-key',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        dedupeKey: 'caller-snake-dedupe-key',
      }),
    );
  });

  it('carries project context into delegated workflow trigger data', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      task_prompt: 'Refine strategy.',
      scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'orchestration_invoke_agent_default',
      expect.objectContaining({
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        scope_id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      }),
    );
  });

  it('does not preserve blank scope fields in delegated trigger data', async () => {
    await service.invokeAgentWorkflow({
      agent_profile: 'product-manager',
      trigger_data: {
        scopeId: '   ',
        scope_id: '   ',
      },
    });

    const triggerData = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(triggerData).not.toHaveProperty('scopeId');
    expect(triggerData).not.toHaveProperty('scope_id');
  });

  it('promotes project context from opaque context into delegated workflow trigger data', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      task_prompt: 'Bootstrap discovery.',
      context: {
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        scope_id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      }),
    );
  });

  it('repairs malformed delegated scope_id from the parent workflow run trigger', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_codebase_deep_investigation',
      workflow_run_id: 'parent-run-1',
      task_prompt: 'Investigate repository.',
      trigger_data: {
        scope_id: 'nexus-orchestrator-app',
        repositoryUrl: 'https://github.com/org/repo',
      },
    });

    expect(workflowPersistence.getWorkflowRun).toHaveBeenCalledWith(
      'parent-run-1',
    );
    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_codebase_deep_investigation',
      expect.objectContaining({
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        scope_id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        repositoryUrl: 'https://github.com/org/repo',
      }),
    );
  });

  it('continues delegated invocation when parent scope lookup is not found', async () => {
    workflowPersistence.getWorkflowRun.mockRejectedValue(
      new NotFoundException('Parent run missing-parent-run not found'),
    );

    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      workflow_run_id: 'missing-parent-run',
      task_prompt: 'Bootstrap discovery.',
      trigger_data: {
        repositoryUrl: 'https://github.com/org/repo',
        basePath: '/data/repos/project',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        repositoryUrl: 'https://github.com/org/repo',
        basePath: '/data/repos/project',
      }),
    );
  });

  it('rethrows unexpected parent workflow lookup failures without launching a child workflow', async () => {
    const lookupError = new Error('workflow run repository unavailable');
    workflowPersistence.getWorkflowRun.mockRejectedValue(lookupError);

    await expect(
      service.invokeAgentWorkflow({
        workflow_id: 'project_discovery_ceo',
        workflow_run_id: 'parent-run-1',
        task_prompt: 'Bootstrap discovery.',
        trigger_data: {
          repositoryUrl: 'https://github.com/org/repo',
          basePath: '/data/repos/project',
        },
      }),
    ).rejects.toThrow(lookupError);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });

  it('propagates basePath and repositoryUrl from parent workflow trigger to child workflow', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
          basePath: '/data/repos/project-1',
          repositoryUrl: 'https://github.com/org/repo',
        },
      },
    });

    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      workflow_run_id: 'parent-run-1',
      task_prompt: 'Bootstrap discovery.',
      context: {
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        scope_id: '70945876-acf1-4ec4-bd7b-ea0121f90140',
        basePath: '/data/repos/project-1',
        repositoryUrl: 'https://github.com/org/repo',
      }),
    );
  });

  it('combines explicit basePath with parent repositoryUrl for delegated workflow context', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
          repositoryUrl: 'https://github.com/org/repo',
        },
      },
    });

    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      workflow_run_id: 'parent-run-1',
      task_prompt: 'Bootstrap discovery.',
      trigger_data: {
        basePath: '/data/repos/explicit-project',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        basePath: '/data/repos/explicit-project',
        repositoryUrl: 'https://github.com/org/repo',
      }),
    );
  });

  it('combines parent basePath with explicit repositoryUrl for delegated workflow context', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
          basePath: '/data/repos/parent-project',
        },
      },
    });

    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      workflow_run_id: 'parent-run-1',
      task_prompt: 'Bootstrap discovery.',
      trigger_data: {
        repositoryUrl: 'https://github.com/org/explicit-repo',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        basePath: '/data/repos/parent-project',
        repositoryUrl: 'https://github.com/org/explicit-repo',
      }),
    );
  });

  it('uses explicit snake_case base_path before parent basePath for delegated workflow context', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
          basePath: '/data/repos/parent-project',
        },
      },
    });

    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      workflow_run_id: 'parent-run-1',
      task_prompt: 'Bootstrap discovery.',
      trigger_data: {
        base_path: '/data/repos/explicit-snake-project',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        basePath: '/data/repos/explicit-snake-project',
      }),
    );
  });

  it('uses snake_case repository context when camelCase trigger context is blank', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      task_prompt: 'Bootstrap discovery.',
      trigger_data: {
        basePath: '   ',
        base_path: '/data/repos/explicit-snake-project',
        repositoryUrl: '   ',
        repository_url: 'https://github.com/org/snake-repo',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        basePath: '/data/repos/explicit-snake-project',
        repositoryUrl: 'https://github.com/org/snake-repo',
      }),
    );
  });

  it('does not preserve blank repository context fields', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      task_prompt: 'Bootstrap discovery.',
      trigger_data: {
        basePath: '   ',
        base_path: '   ',
        repositoryUrl: '   ',
        repository_url: '   ',
      },
    });

    const triggerData = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;

    expect(triggerData).not.toHaveProperty('basePath');
    expect(triggerData).not.toHaveProperty('base_path');
    expect(triggerData).not.toHaveProperty('repositoryUrl');
    expect(triggerData).not.toHaveProperty('repository_url');
  });

  it('does not derive imported-repo discovery route from trigger hints', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      task_prompt:
        'This is an existing repository. Bootstrap discovery before creating backlog.',
      scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.not.objectContaining({
        selectedRoute: expect.any(String),
        selectedRuleId: expect.any(String),
      }),
    );
  });

  it('does not derive imported-repo discovery route from imported git repository wording', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      task_prompt:
        'Use this imported git repository as the starting point for project discovery.',
      scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.not.objectContaining({
        selectedRoute: expect.any(String),
        selectedRuleId: expect.any(String),
      }),
    );
  });

  it('uses snake_case parent trigger keys for imported repository context propagation', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
          base_path: '/data/repos/project-1',
          repository_url: 'https://github.com/org/repo',
        },
      },
    });

    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      workflow_run_id: 'parent-run-1',
      task_prompt: 'Bootstrap discovery for imported repository.',
      context: {
        scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        basePath: '/data/repos/project-1',
        repositoryUrl: 'https://github.com/org/repo',
      }),
    );
  });

  it('does not override explicit selectedRoute for discovery workflow invocations', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      task_prompt: 'Discovery request',
      scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      trigger_data: {
        selectedRoute: 'spec-generation',
        selectedRuleId: 'spec_generation',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        selectedRoute: 'spec-generation',
        selectedRuleId: 'spec_generation',
      }),
    );
  });

  it('infers basePath from scopeId when parent trigger omits basePath', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      state_variables: {
        trigger: {
          scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
          repositoryUrl: 'https://github.com/org/repo',
        },
      },
    });

    await service.invokeAgentWorkflow({
      workflow_id: 'project_codebase_deep_investigation',
      workflow_run_id: 'parent-run-1',
      task_prompt: 'Investigate repository.',
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_codebase_deep_investigation',
      expect.objectContaining({
        basePath:
          '/data/nexus-workspaces/clones/70945876-acf1-4ec4-bd7b-ea0121f90140',
        repositoryUrl: 'https://github.com/org/repo',
      }),
    );
  });

  it('does not infer imported-repo route when discovery is invoked with repository context but no route', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      task_prompt: 'Existing imported repository bootstrap discovery.',
      scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      trigger_data: {
        repositoryUrl: 'https://github.com/org/repo',
        basePath: '/data/repos/project',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        repositoryUrl: 'https://github.com/org/repo',
        basePath: '/data/repos/project',
      }),
    );

    const triggerData = workflowEngine.startWorkflow.mock.calls[0]?.[1] as
      | Record<string, unknown>
      | undefined;
    expect(triggerData).not.toHaveProperty('selectedRoute');
    expect(triggerData).not.toHaveProperty('selectedRuleId');
  });

  it('preserves explicit imported-repo route data when provided by caller', async () => {
    await service.invokeAgentWorkflow({
      workflow_id: 'project_discovery_ceo',
      task_prompt: 'Bootstrap discovery for repository.',
      scopeId: '70945876-acf1-4ec4-bd7b-ea0121f90140',
      trigger_data: {
        repositoryUrl: 'https://github.com/org/repo',
        selectedRoute: 'imported-repo-bootstrap',
        selectedRuleId: 'first_run_imported_repo',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_discovery_ceo',
      expect.objectContaining({
        selectedRoute: 'imported-repo-bootstrap',
        selectedRuleId: 'first_run_imported_repo',
      }),
    );
  });
});
