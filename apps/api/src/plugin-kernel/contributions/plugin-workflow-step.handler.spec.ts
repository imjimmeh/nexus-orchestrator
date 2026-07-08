import { describe, expect, it, vi } from 'vitest';
import type { WorkflowStepContribution } from '@nexus/plugin-sdk';
import type { SpecialStepExecutionContext } from '../../workflow/workflow-special-steps/step-special-step.types';
import type { PluginRuntimeManagerService } from '../runtime/plugin-runtime-manager.service';
import { PluginWorkflowStepHandler } from './plugin-workflow-step.handler';

function createContribution(
  overrides: Partial<WorkflowStepContribution> = {},
): WorkflowStepContribution {
  return {
    id: 'summarize',
    type: 'workflow.step',
    displayName: 'Summarize text',
    description: 'Summarizes input text',
    config: {
      stepType: 'plugin:acme:summarize',
      inputContract: 'acme.summarize.inputs',
      operation: 'summarize_text',
      timeoutMs: 5_000,
    },
    ...overrides,
  };
}

function createContext(): SpecialStepExecutionContext {
  return {
    workflowRunId: 'run-1',
    stepId: 'step-1',
    step: {
      id: 'step-1',
      type: 'plugin:acme:summarize',
      tier: 'light',
      inputs: {},
    },
    resolvedStepInputs: {
      text: 'hello',
    },
  };
}

function createRuntimeManager(
  result: Awaited<ReturnType<PluginRuntimeManagerService['invokePlugin']>>,
): PluginRuntimeManagerService {
  return {
    invokePlugin: vi.fn().mockResolvedValue(result),
  } as unknown as PluginRuntimeManagerService;
}

describe('PluginWorkflowStepHandler', () => {
  it('exposes a plugin-owned descriptor with the plugin id', () => {
    const handler = new PluginWorkflowStepHandler(
      {
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        globalCapabilityName: 'plugin:acme.plugin:summarize',
        contribution: createContribution(),
      },
      createRuntimeManager({ ok: true, output: { summary: 'hi' } }),
    );

    expect(handler.type).toBe('plugin:acme.plugin:summarize');
    expect(handler.descriptor).toMatchObject({
      type: 'plugin:acme.plugin:summarize',
      owningDomain: 'plugin',
      pluginId: 'acme.plugin',
      inputContract: 'acme.summarize.inputs',
      displayName: 'Summarize text',
      description: 'Summarizes input text',
    });
  });

  it('invokes the plugin runtime with contribution operation and workflow input', async () => {
    const runtimeManager = createRuntimeManager({
      ok: true,
      output: { summary: 'hi' },
    });
    const handler = new PluginWorkflowStepHandler(
      {
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        globalCapabilityName: 'plugin:acme.plugin:summarize',
        contribution: createContribution(),
      },
      runtimeManager,
    );

    await handler.execute(createContext());

    expect(runtimeManager.invokePlugin).toHaveBeenCalledWith({
      pluginId: 'acme.plugin',
      version: '1.2.3',
      contributionId: 'summarize',
      operation: 'summarize_text',
      input: { text: 'hello' },
      actorId: 'workflow-step:run-1:step-1',
      timeoutMs: 5_000,
      metadata: {
        workflowRunId: 'run-1',
        stepId: 'step-1',
        stepType: 'plugin:acme:summarize',
      },
    });
  });

  it('maps successful plugin output to plugin special-step result and output records', async () => {
    const handler = new PluginWorkflowStepHandler(
      {
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        globalCapabilityName: 'plugin:acme.plugin:summarize',
        contribution: createContribution(),
      },
      createRuntimeManager({ ok: true, output: { summary: 'hi' } }),
    );

    const result = await handler.execute(createContext());

    expect(result).toEqual({
      result: {
        status: 'completed',
        source: 'plugin',
        mode: 'plugin:acme.plugin:summarize',
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
      },
      output: {
        ok: true,
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        result: { summary: 'hi' },
      },
    });
  });

  it('maps runtime errors to safe special-step failures', async () => {
    const handler = new PluginWorkflowStepHandler(
      {
        pluginId: 'acme.plugin',
        version: '1.2.3',
        contributionId: 'summarize',
        globalCapabilityName: 'plugin:acme.plugin:summarize',
        contribution: createContribution(),
      },
      createRuntimeManager({
        ok: false,
        error: {
          code: 'runtime_error',
          message:
            'failed with secret TOKEN=abc at C:/Users/jimme/project/.env and payload {"password":"x"}',
          retryable: true,
          details: { path: 'C:/Users/jimme/project/.env', secret: 'abc' },
        },
      }),
    );

    await expect(handler.execute(createContext())).rejects.toMatchObject({
      message: 'Plugin workflow step failed: runtime_error',
    });
  });
});
