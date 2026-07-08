import { ExecutionContextSchema, WorkflowStatus } from '@nexus/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkflowCoreLifecycleStreamListener } from './workflow-core-lifecycle-stream.listener';

describe('WorkflowCoreLifecycleStreamListener', () => {
  const publisher = {
    publish: vi.fn().mockResolvedValue('1-0'),
  };
  const usageEvents = {
    getRunTotals: vi
      .fn()
      .mockResolvedValue({ totalTokens: 0, inputTokens: 0, outputTokens: 0 }),
    getRunTotalsByModel: vi.fn().mockResolvedValue([]),
  };
  let listener: WorkflowCoreLifecycleStreamListener;

  beforeEach(() => {
    vi.clearAllMocks();
    usageEvents.getRunTotals.mockResolvedValue({
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
    });
    usageEvents.getRunTotalsByModel.mockResolvedValue([]);
    listener = new WorkflowCoreLifecycleStreamListener(
      publisher as never,
      usageEvents as never,
    );
  });

  it('translates workflow run bus events into generic core lifecycle stream envelopes', async () => {
    await listener.onRunStarted({
      workflowRunId: 'run-1',
      workflowId: 'wf-1',
      status: WorkflowStatus.RUNNING,
      stateVariables: {},
      triggerData: {
        context: {
          scope_id: 'project-1',
          context_id: 'project-1',
          context_type: 'project',
          metadata: { context_id: 'resource-1' },
        },
      },
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'core.workflow.run.status_changed.v1',
        source_service: 'core',
        payload: expect.objectContaining({
          run_id: 'run-1',
          workflow_id: 'wf-1',
          status: WorkflowStatus.RUNNING,
          context: {
            scopeId: 'project-1',
            contextId: 'project-1',
            contextType: 'project',
            metadata: { context_id: 'resource-1' },
            scopeNodeId: null,
            scopePath: null,
          },
        }),
      }),
    );
    const envelope = publisher.publish.mock.calls[0][0];
    expect(envelope.payload).not.toHaveProperty('scope_id');
    expect(envelope.payload).not.toHaveProperty('contextId');
  });

  it('publishes completed workflow run events with parseable execution context', async () => {
    await listener.onRunCompleted({
      workflowRunId: 'run-1',
      workflowId: 'workflow-1',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {},
      triggerData: {
        context: {
          scope_id: 'project-1',
          context_id: 'project-1',
          context_type: 'external.scope',
          metadata: { context_id: '__orchestration_lifecycle__' },
        },
      },
    });

    const envelope = publisher.publish.mock.calls[0][0];
    expect(envelope).toEqual(
      expect.objectContaining({
        event_type: 'core.workflow.run.completed.v1',
        payload: expect.objectContaining({
          run_id: 'run-1',
          workflow_id: 'workflow-1',
          status: WorkflowStatus.COMPLETED,
          context: {
            scopeId: 'project-1',
            contextId: 'project-1',
            contextType: 'external.scope',
            metadata: { context_id: '__orchestration_lifecycle__' },
            scopeNodeId: null,
            scopePath: null,
          },
        }),
      }),
    );
    expect(() =>
      ExecutionContextSchema.parse(envelope.payload.context),
    ).not.toThrow();
  });

  it('normalizes top-level workflow run context fields when nested context is absent', async () => {
    await listener.onRunStarted({
      workflowRunId: 'run-1',
      workflowId: 'wf-1',
      status: WorkflowStatus.RUNNING,
      stateVariables: {},
      triggerData: {
        scopeId: 'scope-1',
        contextId: 'context-1',
        contextType: 'external.scope',
        metadata: { source: 'event-trigger' },
      },
    });

    const envelope = publisher.publish.mock.calls[0][0];
    expect(envelope.payload.context).toEqual({
      scopeId: 'scope-1',
      contextId: 'context-1',
      contextType: 'external.scope',
      metadata: { source: 'event-trigger' },
      scopeNodeId: null,
      scopePath: null,
    });
    expect(() =>
      ExecutionContextSchema.parse(envelope.payload.context),
    ).not.toThrow();
  });

  it('publishes existing camelCase workflow run context unchanged', async () => {
    const context = {
      scopeId: 'project-1',
      contextId: 'project-1',
      contextType: 'external.scope',
      metadata: { context_id: '__orchestration_lifecycle__' },
      scopeNodeId: null,
      scopePath: null,
    };

    await listener.onRunCompleted({
      workflowRunId: 'run-1',
      workflowId: 'workflow-1',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {},
      triggerData: { context },
    });

    const envelope = publisher.publish.mock.calls[0][0];
    expect(envelope.payload.context).toEqual(context);
    expect(() =>
      ExecutionContextSchema.parse(envelope.payload.context),
    ).not.toThrow();
  });

  it('attaches cumulative run usage totals on terminal run events', async () => {
    usageEvents.getRunTotals.mockResolvedValueOnce({
      totalTokens: 1500,
      inputTokens: 1200,
      outputTokens: 300,
      estimatedCostCents: 12,
      pricedTurnCount: 403,
    });

    await listener.onRunCompleted({
      workflowRunId: 'run-1',
      workflowId: 'workflow-1',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {},
      triggerData: {},
    });

    expect(usageEvents.getRunTotals).toHaveBeenCalledWith('run-1');
    const envelope = publisher.publish.mock.calls[0][0];
    expect(envelope.payload.usage).toEqual({
      total_tokens: 1500,
      input_tokens: 1200,
      output_tokens: 300,
      estimated_cost_cents: 12,
      priced_turn_count: 403,
      model_breakdown: null,
    });
  });

  it('attaches a per-model usage breakdown on terminal run events', async () => {
    usageEvents.getRunTotals.mockResolvedValueOnce({
      totalTokens: 1500,
      inputTokens: 1200,
      outputTokens: 300,
      estimatedCostCents: 12,
      pricedTurnCount: 403,
    });
    usageEvents.getRunTotalsByModel = vi.fn().mockResolvedValueOnce([
      {
        model_id: 'model-1',
        provider_name: 'anthropic',
        model_name: 'claude-sonnet-5',
        input_tokens: 1200,
        output_tokens: 300,
        cost_cents: 12,
      },
    ]);

    await listener.onRunCompleted({
      workflowRunId: 'run-1',
      workflowId: 'workflow-1',
      status: WorkflowStatus.COMPLETED,
      stateVariables: {},
      triggerData: {},
    });

    expect(usageEvents.getRunTotalsByModel).toHaveBeenCalledWith('run-1');
    const envelope = publisher.publish.mock.calls[0][0];
    expect(envelope.payload.usage).toEqual({
      total_tokens: 1500,
      input_tokens: 1200,
      output_tokens: 300,
      estimated_cost_cents: 12,
      priced_turn_count: 403,
      model_breakdown: [
        {
          model_id: 'model-1',
          provider_name: 'anthropic',
          model_name: 'claude-sonnet-5',
          input_tokens: 1200,
          output_tokens: 300,
          cost_cents: 12,
        },
      ],
    });
  });

  it('does not query or attach usage for non-terminal run events', async () => {
    await listener.onRunStarted({
      workflowRunId: 'run-1',
      workflowId: 'wf-1',
      status: WorkflowStatus.RUNNING,
      stateVariables: {},
      triggerData: {},
    });

    expect(usageEvents.getRunTotals).not.toHaveBeenCalled();
    const envelope = publisher.publish.mock.calls[0][0];
    expect(envelope.payload).not.toHaveProperty('usage');
  });

  it('translates workflow job bus events into core workflow step envelopes', async () => {
    await listener.onJobCompleted({
      workflowRunId: 'run-1',
      workflowId: 'wf-1',
      jobId: 'job-1',
      output: { ok: true },
      payload: {
        context: {
          scope_id: 'project-1',
          context_id: 'project-1',
          context_type: 'project',
          metadata: { context_id: 'resource-1' },
        },
      },
    });

    expect(publisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'core.workflow.step.completed.v1',
        source_service: 'core',
        payload: expect.objectContaining({
          run_id: 'run-1',
          workflow_id: 'wf-1',
          job_id: 'job-1',
          step_id: 'job-1',
          status: 'COMPLETED',
          context: {
            scopeId: 'project-1',
            contextId: 'project-1',
            contextType: 'project',
            metadata: { context_id: 'resource-1' },
            scopeNodeId: null,
            scopePath: null,
          },
        }),
      }),
    );
    const envelope = publisher.publish.mock.calls[0][0];
    expect(envelope.payload).not.toHaveProperty('scope_id');
    expect(envelope.payload).not.toHaveProperty('contextId');
  });
});
