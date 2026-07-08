import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConflictException } from '@nestjs/common';
import { McpTransportType } from '@nexus/core';
import type { WorkflowRunRequestV1 } from '@nexus/core';
import { WorkflowInternalCoreRunsService } from './workflow-internal-core-runs.service';

describe('WorkflowInternalCoreRunsService', () => {
  const workflowEngine = {
    startWorkflow: vi.fn(),
  };

  const workflowPersistence = {
    getWorkflowRun: vi.fn(),
    getActiveWorkflowRunsByScopeId: vi.fn(),
  };

  const workflowRunSteering = {
    pause: vi.fn(),
    resume: vi.fn(),
    abort: vi.fn(),
  };

  const eventEmitter = {
    emit: vi.fn(),
  };

  let service: WorkflowInternalCoreRunsService;

  beforeEach(() => {
    vi.resetAllMocks();

    workflowEngine.startWorkflow.mockResolvedValue('run-1');
    workflowPersistence.getWorkflowRun.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: 'RUNNING',
      current_step_id: 'job-1',
      state_variables: {
        trigger: {
          context: {
            scopeId: 'project-1',
            contextId: 'project-1',
            contextType: 'external.project',
            scopeNodeId: null,
            scopePath: null,
            metadata: { contextId: 'resource-1' },
          },
        },
      },
      updated_at: new Date('2026-04-13T12:00:00.000Z'),
    });
    workflowPersistence.getActiveWorkflowRunsByScopeId.mockResolvedValue([
      {
        id: 'run-1',
        workflow_id: 'wf-1',
        status: 'RUNNING',
      },
    ]);
    workflowRunSteering.pause.mockResolvedValue({ containerId: 'container-1' });
    workflowRunSteering.resume.mockResolvedValue({
      containerId: 'container-1',
    });
    workflowRunSteering.abort.mockResolvedValue({ containerId: 'container-1' });

    service = new WorkflowInternalCoreRunsService(
      workflowEngine as never,
      workflowRunSteering as never,
      workflowPersistence as never,
      eventEmitter,
    );
  });

  it('accepts workflow run requests and emits core lifecycle envelopes', async () => {
    const result = await service.requestWorkflowRun({
      workflow_id: 'wf-1',
      input: {
        scope_id: 'project-1',
      },
      launch_source: 'internal_core_api',
      context: {
        scopeId: 'project-1',
        contextId: 'project-1',
        contextType: 'external.project',
        scopeNodeId: null,
        scopePath: null,
        metadata: { contextId: 'resource-1' },
      },
      metadata: {
        correlation_id: 'corr-1',
        requested_by: 'internal-test',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        run_id: 'run-1',
        workflow_id: 'wf-1',
        status: 'accepted',
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
    expect(eventEmitter.emit).toHaveBeenNthCalledWith(
      1,
      'workflow.core.lifecycle',
      expect.objectContaining({
        runId: 'run-1',
        workflowId: 'wf-1',
        envelope: expect.objectContaining({
          event_type: 'core.workflow.run.requested.v1',
          payload: expect.objectContaining({
            context: {
              scopeId: 'project-1',
              contextId: 'project-1',
              contextType: 'external.project',
              metadata: { contextId: 'resource-1' },
              scopeNodeId: null,
              scopePath: null,
            },
          }),
        }),
      }),
    );
    expect(eventEmitter.emit).toHaveBeenNthCalledWith(
      2,
      'workflow.core.lifecycle',
      expect.objectContaining({
        runId: 'run-1',
        workflowId: 'wf-1',
        envelope: expect.objectContaining({
          event_type: 'core.workflow.run.accepted.v1',
          payload: expect.objectContaining({
            context: {
              scopeId: 'project-1',
              contextId: 'project-1',
              contextType: 'external.project',
              metadata: { contextId: 'resource-1' },
              scopeNodeId: null,
              scopePath: null,
            },
          }),
        }),
      }),
    );
  });

  it('buildRunInput passes external_mcp_mounts through to engine start input', () => {
    const input = { scope_id: 'project-1' };
    const mounts: NonNullable<WorkflowRunRequestV1['external_mcp_mounts']> = [
      {
        id: 'external-mcp-1',
        server_id: 'external-mcp',
        url: 'http://external-mcp:3100',
        transport_type: McpTransportType.HTTP,
        include_tools: [
          'external.scope_state',
          'external.orchestration_timeline',
        ],
      },
    ];

    const result = (service as any).buildRunInput({
      input,
      external_mcp_mounts: mounts,
    });

    expect(result).toEqual({
      scope_id: 'project-1',
      external_mcp_mounts: mounts,
    });
  });

  it('buildRunInput returns input unchanged when no external_mcp_mounts', () => {
    const input = { scope_id: 'project-1' };

    const result = (service as any).buildRunInput({
      input,
    });

    expect(result).toBe(input);
  });

  it('buildRunInput handles null input with external_mcp_mounts', () => {
    const mounts: NonNullable<WorkflowRunRequestV1['external_mcp_mounts']> = [
      {
        id: 'external-mcp-1',
        server_id: 'external-mcp',
        url: 'http://external-mcp:3100',
        transport_type: McpTransportType.HTTP,
        include_tools: ['external.scope_state'],
      },
    ];

    const result = (service as any).buildRunInput({
      input: null,
      external_mcp_mounts: mounts,
    });

    expect(result).toEqual({ external_mcp_mounts: mounts });
  });

  it('buildRunInput handles empty external_mcp_mounts array', () => {
    const input = { scope_id: 'project-1' };

    const result = (service as any).buildRunInput({
      input,
      external_mcp_mounts: [],
    });

    expect(result).toBe(input);
  });

  it('preserves definition ids in the external accepted contract', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'workflow-row-uuid',
      status: 'RUNNING',
      current_step_id: 'job-1',
      state_variables: { trigger: { scope_id: 'project-1' } },
      updated_at: new Date('2026-04-13T12:00:00.000Z'),
    });

    await service.requestWorkflowRun({
      workflow_id: 'project_orchestration_cycle_ceo',
      input: {
        scope_id: 'project-1',
      },
      launch_source: 'internal_core_api',
      metadata: {
        correlation_id: 'corr-definition-id',
        requested_by: 'internal-test',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      'project_orchestration_cycle_ceo',
      { scope_id: 'project-1' },
    );
  });

  it('requestWorkflowRun passes external_mcp_mounts through to engine start input', async () => {
    workflowPersistence.getWorkflowRun.mockResolvedValueOnce({
      id: 'run-2',
      workflow_id: 'wf-1',
      status: 'RUNNING',
      current_step_id: null,
      state_variables: {},
      updated_at: new Date(),
    });

    const mounts: NonNullable<WorkflowRunRequestV1['external_mcp_mounts']> = [
      {
        id: 'external-mcp-1',
        server_id: 'external-mcp',
        url: 'http://external-mcp:3100',
        transport_type: McpTransportType.HTTP,
        include_tools: [
          'external.scope_state',
          'external.orchestration_timeline',
        ],
      },
    ];

    await service.requestWorkflowRun({
      workflow_id: 'wf-1',
      input: { scope_id: 'project-1' },
      external_mcp_mounts: mounts,
      launch_source: 'internal_core_api',
      metadata: { correlation_id: 'corr-ext-mounts' },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith('wf-1', {
      scope_id: 'project-1',
      external_mcp_mounts: mounts,
    });
  });

  it('requestWorkflowRun passes metadata idempotency key as launch dedupe key to engine start input', async () => {
    await service.requestWorkflowRun({
      workflow_id: 'wf-1',
      input: { scope_id: 'project-1' },
      launch_source: 'internal_core_api',
      metadata: {
        correlation_id: 'corr-dedupe',
        idempotency_key: 'project-1:cycle-1',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith('wf-1', {
      scope_id: 'project-1',
      dedupeKey: 'project-1:cycle-1',
    });
  });

  it('requestWorkflowRun persists request context in engine start input for terminal lifecycle events', async () => {
    const context = {
      scopeId: 'project-1',
      contextId: 'project-1',
      contextType: 'external.scope',
      metadata: { contextId: '__orchestration_lifecycle__' },
      scopeNodeId: null,
      scopePath: null,
    };

    await service.requestWorkflowRun({
      workflow_id: 'wf-1',
      input: { scope_id: 'project-1' },
      launch_source: 'internal_core_api',
      context,
      metadata: { correlation_id: 'corr-context' },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith('wf-1', {
      scope_id: 'project-1',
      context,
    });
  });

  it('requestWorkflowRun preserves explicit input dedupeKey and context while adding external_mcp_mounts', async () => {
    const inputContext = {
      scopeId: 'input-project',
      contextId: 'input-project',
      contextType: 'external.scope',
      metadata: { contextId: 'input-resource' },
    };
    const requestContext = {
      scopeId: 'request-project',
      contextId: 'request-project',
      contextType: 'external.scope',
      scopeNodeId: null,
      scopePath: null,
      metadata: { contextId: 'request-resource' },
    };
    const mounts: NonNullable<WorkflowRunRequestV1['external_mcp_mounts']> = [
      {
        id: 'external-mcp-1',
        server_id: 'external-mcp',
        url: 'http://external-mcp:3100',
        transport_type: McpTransportType.HTTP,
      },
    ];

    await service.requestWorkflowRun({
      workflow_id: 'wf-1',
      input: {
        scope_id: 'project-1',
        dedupeKey: 'explicit-input-dedupe',
        context: inputContext,
      },
      external_mcp_mounts: mounts,
      launch_source: 'internal_core_api',
      context: requestContext,
      metadata: {
        correlation_id: 'corr-preserve-input',
        idempotency_key: 'metadata-dedupe',
      },
    });

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith('wf-1', {
      scope_id: 'project-1',
      dedupeKey: 'explicit-input-dedupe',
      context: inputContext,
      external_mcp_mounts: mounts,
    });
  });

  it('rejects start requests skipped by concurrency policy', async () => {
    workflowEngine.startWorkflow.mockResolvedValueOnce(null);

    await expect(
      service.requestWorkflowRun({
        workflow_id: 'wf-1',
        input: {},
        launch_source: 'internal_core_api',
        metadata: {
          correlation_id: 'corr-1',
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('controls runs and emits status changed envelope', async () => {
    const result = await service.controlWorkflowRun('run-1', {
      run_id: 'run-1',
      action: 'pause',
      reason: 'operator_pause',
      metadata: {
        correlation_id: 'corr-2',
        requested_by: 'internal-test',
      },
    });

    expect(workflowRunSteering.pause).toHaveBeenCalledWith('run-1');
    expect(result).toEqual(
      expect.objectContaining({
        run_id: 'run-1',
        action: 'pause',
        accepted: true,
      }),
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'workflow.core.lifecycle',
      expect.objectContaining({
        runId: 'run-1',
        workflowId: 'wf-1',
        envelope: expect.objectContaining({
          event_type: 'core.workflow.run.status_changed.v1',
          payload: expect.objectContaining({
            context: {
              scopeId: 'project-1',
              contextId: 'project-1',
              contextType: 'external.project',
              metadata: { contextId: 'resource-1' },
              scopeNodeId: null,
              scopePath: null,
            },
          }),
        }),
      }),
    );
  });

  it('returns contract-shaped workflow run status', async () => {
    const result = await service.getWorkflowRunStatus('run-1');

    expect(result).toEqual(
      expect.objectContaining({
        run_id: 'run-1',
        workflow_id: 'wf-1',
        status: 'RUNNING',
      }),
    );
    expect(result.metadata.correlation_id.length).toBeGreaterThan(0);
  });

  it('cancels active workflow runs for a scope with provided reason', async () => {
    workflowPersistence.getActiveWorkflowRunsByScopeId.mockResolvedValueOnce([
      {
        id: '11111111-1111-4111-8111-111111111111',
        workflow_id: 'wf-1',
        status: 'RUNNING',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        workflow_id: 'wf-2',
        status: 'PENDING',
      },
    ]);

    const result = await service.cancelWorkflowRunsByScope('project-1', {
      reason: 'project_deleted',
      metadata: {
        correlation_id: 'corr-4',
        requested_by: 'workflow-service',
      },
    });

    expect(
      workflowPersistence.getActiveWorkflowRunsByScopeId,
    ).toHaveBeenCalledWith('project-1');
    expect(workflowRunSteering.abort).toHaveBeenNthCalledWith(
      1,
      '11111111-1111-4111-8111-111111111111',
      'project_deleted',
    );
    expect(workflowRunSteering.abort).toHaveBeenNthCalledWith(
      2,
      '22222222-2222-4222-8222-222222222222',
      'project_deleted',
    );
    expect(result).toEqual(
      expect.objectContaining({
        scope_id: 'project-1',
        requested_runs: 2,
        cancelled_runs: 2,
        skipped_runs: 0,
        cancelled_run_ids: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
        reason: 'project_deleted',
      }),
    );
  });

  it('continues cancellation and reports skipped runs when aborting a scope run fails', async () => {
    workflowPersistence.getActiveWorkflowRunsByScopeId.mockResolvedValueOnce([
      {
        id: '11111111-1111-4111-8111-111111111111',
        workflow_id: 'wf-1',
        status: 'RUNNING',
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        workflow_id: 'wf-2',
        status: 'PENDING',
      },
    ]);
    workflowRunSteering.abort
      .mockResolvedValueOnce({ containerId: 'container-1' })
      .mockRejectedValueOnce(new Error('container missing'));

    const result = await service.cancelWorkflowRunsByScope('project-1', {
      reason: 'project_deleted',
      metadata: {
        correlation_id: 'corr-5',
        requested_by: 'workflow-service',
      },
    });

    expect(result).toEqual(
      expect.objectContaining({
        scope_id: 'project-1',
        requested_runs: 2,
        cancelled_runs: 1,
        skipped_runs: 1,
        cancelled_run_ids: ['11111111-1111-4111-8111-111111111111'],
      }),
    );
  });
});
