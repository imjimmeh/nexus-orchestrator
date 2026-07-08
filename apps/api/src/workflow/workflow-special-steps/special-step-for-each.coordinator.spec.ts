import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IJob } from '@nexus/core';
import type { IWorkflowEngineService } from '../kernel/interfaces/workflow-kernel.ports';
import type { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { resolveTemplatedInputs } from '../workflow-step-execution/step-support-inputs.helpers';
import { SpecialStepForEachCoordinator } from './special-step-for-each.coordinator';
import type {
  ISpecialStepHandler,
  SpecialStepHandlerResult,
} from './step-special-step.types';

type WorkflowEngineMock = {
  handleJobComplete: ReturnType<typeof vi.fn>;
};

function createCoordinator() {
  const workflowEngine: WorkflowEngineMock = {
    handleJobComplete: vi.fn().mockResolvedValue(undefined),
  };
  const support = {
    resolveJobInputs: vi.fn(
      (
        inputs: Record<string, unknown> | undefined,
        variables: Record<string, unknown>,
      ) => resolveTemplatedInputs(inputs, variables, (value) => value),
    ),
  } as unknown as StepSupportService;
  const eventPublisher = {
    createEvent: vi.fn((eventType: string, payload: unknown) => ({
      event_type: eventType,
      payload,
      timestamp: new Date().toISOString(),
    })),
    publishBestEffort: vi.fn().mockResolvedValue(undefined),
  } as unknown as StepEventPublisherService;

  const coordinator = new SpecialStepForEachCoordinator(
    workflowEngine as unknown as IWorkflowEngineService,
    eventPublisher,
    support,
  );

  return { coordinator, workflowEngine, eventPublisher, support };
}

function createHandler(
  executeImpl: (context: {
    workflowRunId: string;
    stepId: string;
    step: IJob;
    resolvedStepInputs: Record<string, unknown>;
  }) => Promise<SpecialStepHandlerResult>,
): { handler: ISpecialStepHandler; execute: ReturnType<typeof vi.fn> } {
  const execute = vi.fn(executeImpl);
  const handler: ISpecialStepHandler = {
    type: 'mcp_tool_call',
    descriptor: {
      type: 'mcp_tool_call',
      owningDomain: 'core',
      inputContract: 'inputs.server_id + inputs.tool_name',
    },
    execute,
  };
  return { handler, execute };
}

function buildStep(overrides: Record<string, unknown> = {}): IJob {
  return {
    id: 'materialize',
    type: 'mcp_tool_call',
    tier: 'light',
    for_each: '{{ jobs.upstream.output.items }}',
    inputs: {
      server_id: 'external-mcp',
      tool_name: 'external.resource_subtask_upsert',
      params: {
        subtask_id: '{{ item.id }}',
        title: '{{ item.title }}',
      },
    },
    ...overrides,
  };
}

describe('SpecialStepForEachCoordinator', () => {
  let coordinator: SpecialStepForEachCoordinator;
  let workflowEngine: WorkflowEngineMock;
  let eventPublisher: StepEventPublisherService;
  let support: StepSupportService;

  beforeEach(() => {
    ({ coordinator, workflowEngine, eventPublisher, support } =
      createCoordinator());
  });

  it('dispatches one handler invocation per item with item.* template resolution', async () => {
    const items = [
      { id: 'subtask-1', title: 'First subtask' },
      { id: 'subtask-2', title: 'Second subtask' },
      { id: 'subtask-3', title: 'Third subtask' },
    ];
    const templateVariables = { jobs: { upstream: { output: { items } } } };
    const { handler, execute } = createHandler(
      async ({ resolvedStepInputs }) => ({
        result: {
          status: 'completed',
          mode: 'mcp_tool_call',
          serverId: 'external-mcp',
          toolName: 'external.resource_subtask_upsert',
        },
        output: { ok: true, ...resolvedStepInputs },
      }),
    );

    const result = await coordinator.execute({
      workflowRunId: 'run-1',
      stepId: 'materialize',
      step: buildStep(),
      handler,
      rawInputsTemplate: {
        server_id: 'external-mcp',
        tool_name: 'external.resource_subtask_upsert',
        params: {
          subtask_id: '{{ item.id }}',
          title: '{{ item.title }}',
        },
      },
      templateVariables,
    });

    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        workflowRunId: 'run-1',
        stepId: 'materialize',
        resolvedStepInputs: expect.objectContaining({
          params: expect.objectContaining({
            subtask_id: 'subtask-1',
            title: 'First subtask',
          }),
        }),
      }),
    );
    expect(execute).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        resolvedStepInputs: expect.objectContaining({
          params: expect.objectContaining({
            subtask_id: 'subtask-2',
            title: 'Second subtask',
          }),
        }),
      }),
    );
    expect(execute).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        resolvedStepInputs: expect.objectContaining({
          params: expect.objectContaining({
            subtask_id: 'subtask-3',
            title: 'Third subtask',
          }),
        }),
      }),
    );

    expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
      'run-1',
      'materialize',
      expect.objectContaining({
        ok: true,
        iterations: 3,
        results: expect.any(Array),
        errors: [],
      }),
    );
    expect(eventPublisher.publishBestEffort).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        event_type: 'turn_end',
        payload: expect.objectContaining({
          stepId: 'materialize',
          output: expect.objectContaining({ ok: true, iterations: 3 }),
        }),
      }),
    );

    expect(result).toEqual({
      status: 'completed',
      mode: 'for_each',
      iterations: 3,
      errorCount: 0,
    });
  });

  it('aggregates per-iteration errors when continue_on_error is enabled', async () => {
    const items = [
      { id: 'subtask-1' },
      { id: 'subtask-2' },
      { id: 'subtask-3' },
    ];
    const templateVariables = { jobs: { upstream: { output: { items } } } };
    let callIndex = 0;
    const { handler, execute } = createHandler(async () => {
      callIndex += 1;
      if (callIndex === 2) {
        throw new Error('upstream rejection on subtask-2');
      }
      return {
        result: {
          status: 'completed',
          mode: 'mcp_tool_call',
          serverId: 'external-mcp',
          toolName: 'external.resource_subtask_upsert',
        },
        output: { ok: true, index: callIndex },
      };
    });

    const result = await coordinator.execute({
      workflowRunId: 'run-1',
      stepId: 'materialize',
      step: buildStep({ continue_on_error: true }),
      handler,
      rawInputsTemplate: {
        server_id: 'external-mcp',
        tool_name: 'external.resource_subtask_upsert',
      },
      templateVariables,
    });

    expect(execute).toHaveBeenCalledTimes(3);

    expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
      'run-1',
      'materialize',
      expect.objectContaining({
        ok: false,
        iterations: 3,
        errors: [{ index: 1, error: 'upstream rejection on subtask-2' }],
        results: expect.any(Array),
      }),
    );

    expect(result).toEqual({
      status: 'completed',
      mode: 'for_each',
      iterations: 3,
      errorCount: 1,
    });
  });

  it('rethrows on first failure when continue_on_error is not set', async () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    const templateVariables = { jobs: { upstream: { output: { items } } } };
    const { handler, execute } = createHandler(async () => {
      throw new Error('handler blew up');
    });

    await expect(
      coordinator.execute({
        workflowRunId: 'run-1',
        stepId: 'materialize',
        step: buildStep(),
        handler,
        rawInputsTemplate: {
          server_id: 'external-mcp',
          tool_name: 'external.resource_subtask_upsert',
        },
        templateVariables,
      }),
    ).rejects.toThrow('handler blew up');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(workflowEngine.handleJobComplete).not.toHaveBeenCalled();
  });

  it('emits an empty aggregate for an empty items array', async () => {
    const templateVariables = { jobs: { upstream: { output: { items: [] } } } };
    const { handler, execute } = createHandler(async () => ({
      result: {
        status: 'completed',
        mode: 'mcp_tool_call',
        serverId: 'external-mcp',
        toolName: 'external.resource_subtask_upsert',
      },
      output: { ok: true },
    }));

    const result = await coordinator.execute({
      workflowRunId: 'run-1',
      stepId: 'materialize',
      step: buildStep(),
      handler,
      rawInputsTemplate: {
        server_id: 'external-mcp',
        tool_name: 'external.resource_subtask_upsert',
      },
      templateVariables,
    });

    expect(execute).not.toHaveBeenCalled();
    expect(workflowEngine.handleJobComplete).toHaveBeenCalledWith(
      'run-1',
      'materialize',
      expect.objectContaining({
        ok: true,
        iterations: 0,
        results: [],
        errors: [],
      }),
    );
    expect(result).toEqual({
      status: 'completed',
      mode: 'for_each',
      iterations: 0,
      errorCount: 0,
    });
  });

  it('throws when for_each expression resolves to a non-array value', async () => {
    const templateVariables = {
      jobs: { upstream: { output: { items: 'not-an-array' } } },
    };
    const { handler } = createHandler(async () => ({
      result: {
        status: 'completed',
        mode: 'mcp_tool_call',
        serverId: 'external-mcp',
        toolName: 'external.resource_subtask_upsert',
      },
      output: { ok: true },
    }));

    await expect(
      coordinator.execute({
        workflowRunId: 'run-1',
        stepId: 'materialize',
        step: buildStep(),
        handler,
        rawInputsTemplate: {
          server_id: 'external-mcp',
          tool_name: 'external.resource_subtask_upsert',
        },
        templateVariables,
      }),
    ).rejects.toThrow('for_each expression must resolve to array, got: string');
  });
});
