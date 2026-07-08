import { describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowPersistenceService } from './workflow-persistence.service';
import { WorkflowLaunchDedupeService } from './workflow-launch-dedupe.service';
import type { WorkflowDefinitionLoaderService } from './workflow-definition-loader.service';
import type { WorkflowEngineLaunchOrchestratorService } from './workflow-engine-launch-orchestrator.service';
import type { WorkflowRunJobExecutionService } from './workflow-run-job-execution.service';
import type { WorkflowJobMessageQueueService } from './workflow-job-message-queue.service';
import type { IWorkflowCancellationCascadeService } from './kernel/interfaces/workflow-kernel.ports';

/**
 * Engine spec after M3. The launch-path (dedupe, concurrency, run creation,
 * initial DAG scheduling) is now exercised end-to-end through the
 * `WorkflowEngineLaunchOrchestratorService` here; this spec stays focused on
 * the engine's narrow responsibilities: dry-run delegation, cancel
 * delegation, the not-active guard, `WORKFLOW_RUN_PAUSED` /
 * `WORKFLOW_RUN_RESUMED` event emission, and the passthrough methods
 * (`handleJobComplete`, `resumeJobWithMessage`, `retryJobWithMessage`).
 */
describe('WorkflowEngineService (delegated engine surface)', () => {
  const createEngine = () => {
    const runRepo = {
      update: vi.fn().mockResolvedValue(undefined),
      create: vi.fn().mockResolvedValue({
        id: 'run-new-1',
        state_variables: {},
      }),
      findById: vi.fn().mockResolvedValue({
        id: 'run-new-1',
        workflow_id: 'wf-1',
        status: 'RUNNING',
        started_at: new Date('2026-06-19T09:00:00.000Z'),
        completed_at: null,
        state_variables: {},
      }),
      findActiveByTriggerContext: vi.fn().mockResolvedValue(null),
      findLatestByWorkflowAndDedupeKey: vi.fn().mockResolvedValue(null),
    };

    const parser = {
      parseWorkflow: vi.fn().mockReturnValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
      }),
    };

    const validator = {
      validateAndThrow: vi.fn().mockResolvedValue(undefined),
    };
    const yamlValidator = {
      validateAndThrow: vi.fn(),
    };
    const workflowDefinitionLoader = {
      loadExecutableDefinition: vi.fn().mockResolvedValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
      }),
    };

    const eventEmitter = { emit: vi.fn() };

    const runExecution: Partial<WorkflowRunJobExecutionService> = {
      enqueueJob: vi.fn().mockResolvedValue(undefined),
      handleJobComplete: vi.fn().mockResolvedValue(undefined),
    };
    const jobMessageQueue: Partial<WorkflowJobMessageQueueService> = {
      resumeJobWithMessage: vi.fn().mockResolvedValue('job-1'),
      retryJobWithMessage: vi.fn().mockResolvedValue(undefined),
    };

    const cancellationCascade: IWorkflowCancellationCascadeService = {
      cancelRun: vi.fn().mockResolvedValue(undefined),
    };

    const launchOrchestrator: Pick<
      WorkflowEngineLaunchOrchestratorService,
      'startAndDedupRun' | 'simulateDryRun'
    > = {
      startAndDedupRun: vi.fn().mockResolvedValue('run-new-1'),
      simulateDryRun: vi.fn().mockResolvedValue({
        dryRun: true as const,
        workflowId: 'wf-1',
        workflowName: 'WF 1',
        executionPath: [],
        parallelGroups: [],
        stateTransitions: [],
        mockJobsApplied: [],
        jobSimulations: [],
      }),
    };

    const repos = {
      workflows: {
        findById: vi.fn().mockResolvedValue({
          id: 'wf-1',
          is_active: true,
          yaml_definition: 'workflow_id: wf_1\nname: WF 1',
        }),
        findByIds: vi.fn().mockResolvedValue([
          {
            id: 'wf-1',
            is_active: true,
            yaml_definition: 'workflow_id: wf_1\nname: WF 1',
          },
        ]),
        findByIdentifier: vi.fn().mockResolvedValue({
          id: 'wf-1',
          is_active: true,
          yaml_definition: 'workflow_id: wf_1\nname: WF 1',
        }),
        findAll: vi.fn().mockResolvedValue([]),
        findPaged: vi.fn().mockResolvedValue({ data: [], total: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'wf-1' }),
        update: vi.fn().mockResolvedValue({ id: 'wf-1' }),
      },
      runs: runRepo,
      agentProfiles: {},
    };

    const persistence = new WorkflowPersistenceService(
      repos as any,
      parser as any,
      validator as any,
      yamlValidator as any,
    );

    const launchDedupe = new WorkflowLaunchDedupeService(runRepo as any);

    const service = new WorkflowEngineService(
      persistence,
      workflowDefinitionLoader as unknown as WorkflowDefinitionLoaderService,
      runExecution as WorkflowRunJobExecutionService,
      eventEmitter as any,
      launchDedupe,
      jobMessageQueue as WorkflowJobMessageQueueService,
      cancellationCascade,
      launchOrchestrator as unknown as WorkflowEngineLaunchOrchestratorService,
    );

    return {
      service,
      runRepo,
      eventEmitter,
      workflowDefinitionLoader,
      cancellationCascade,
      launchOrchestrator,
      runExecution,
      jobMessageQueue,
    };
  };

  it('loads executable definitions through the workflow definition loader', async () => {
    const { service, workflowDefinitionLoader } = createEngine();

    // Mock persistence.getWorkflow to return an active workflow.
    // We use a stub here because persistence is constructed as part of the engine.
    await service.startWorkflow('wf-1', {});

    expect(
      workflowDefinitionLoader.loadExecutableDefinition,
    ).toHaveBeenCalled();
  });

  it('forwards dry-run requests to the launch orchestrator', async () => {
    const { service, launchOrchestrator, workflowDefinitionLoader } =
      createEngine();

    workflowDefinitionLoader.loadExecutableDefinition.mockResolvedValueOnce({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [],
    });

    // Stub the persistence call. We'll reach into the engine's persistence.
    await service.startWorkflow(
      'wf-1',
      { scopeId: 'project-1' },
      { dryRun: true },
    );

    expect(launchOrchestrator.simulateDryRun).toHaveBeenCalledTimes(1);
    expect(launchOrchestrator.simulateDryRun).toHaveBeenCalledWith(
      'wf-1',
      { scopeId: 'project-1' },
      expect.objectContaining({ workflow_id: 'wf_1' }),
      expect.objectContaining({ dryRun: true }),
    );
    expect(launchOrchestrator.startAndDedupRun).not.toHaveBeenCalled();
  });

  it('forwards launch-path requests to the orchestrator after prepareTriggerData', async () => {
    const { service, launchOrchestrator, workflowDefinitionLoader } =
      createEngine();

    workflowDefinitionLoader.loadExecutableDefinition.mockResolvedValueOnce({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [],
    });

    const runId = await service.startWorkflow('wf-1', {
      event: 'external.resource.status_changed.v1',
      scopeId: 'project-1',
      contextId: 'item-1',
      status: 'in-progress',
    });

    expect(runId).toBe('run-new-1');
    expect(launchOrchestrator.startAndDedupRun).toHaveBeenCalledTimes(1);
    expect(launchOrchestrator.startAndDedupRun).toHaveBeenCalledWith(
      'wf-1',
      {
        event: 'external.resource.status_changed.v1',
        scopeId: 'project-1',
        contextId: 'item-1',
        status: 'in-progress',
      },
      expect.objectContaining({ workflow_id: 'wf_1' }),
    );
    expect(launchOrchestrator.simulateDryRun).not.toHaveBeenCalled();
  });

  it('throws when the workflow is not active', async () => {
    const { service } = createEngine();

    // Override persistence.getWorkflow to return a workflow with is_active=false.
    const persistence = (service as unknown as { persistence: any })
      .persistence;
    const originalGetWorkflow = persistence.getWorkflow.bind(persistence);
    persistence.getWorkflow = vi.fn().mockResolvedValueOnce({
      id: 'wf-1',
      is_active: false,
      yaml_definition: 'workflow_id: wf_1\nname: WF 1',
    });

    try {
      await expect(service.startWorkflow('wf-1', {})).rejects.toThrow(
        /not active/i,
      );
    } finally {
      persistence.getWorkflow = originalGetWorkflow;
    }
  });

  it('does not expose catalog or query persistence methods', () => {
    const { service } = createEngine();
    const engine = service as unknown as Record<string, unknown>;

    expect(engine.createWorkflow).toBeUndefined();
    expect(engine.getWorkflow).toBeUndefined();
    expect(engine.getAllWorkflows).toBeUndefined();
    expect(engine.getAllWorkflowsPaged).toBeUndefined();
    expect(engine.getWorkflowRuns).toBeUndefined();
    expect(engine.getWorkflowRunsPaged).toBeUndefined();
    expect(engine.getWorkflowRun).toBeUndefined();
    expect(engine.updateWorkflow).toBeUndefined();
    expect(engine.deleteWorkflow).toBeUndefined();
  });

  it('delegates cancelWorkflowRun to the cancellation cascade with the provided reason', async () => {
    const { service, cancellationCascade } = createEngine();

    await service.cancelWorkflowRun('run-1', 'user_abort');

    expect(cancellationCascade.cancelRun).toHaveBeenCalledTimes(1);
    expect(cancellationCascade.cancelRun).toHaveBeenCalledWith(
      'run-1',
      'user_abort',
    );
  });

  it('defaults the cancel reason to "concurrency_cancel_running" when omitted', async () => {
    const { service, cancellationCascade } = createEngine();

    await service.cancelWorkflowRun('run-1');

    expect(cancellationCascade.cancelRun).toHaveBeenCalledTimes(1);
    expect(cancellationCascade.cancelRun).toHaveBeenCalledWith(
      'run-1',
      'concurrency_cancel_running',
    );
  });

  it('delegates handleJobComplete to the run execution service', async () => {
    const { service, runExecution } = createEngine();

    await service.handleJobComplete('run-1', 'job-1', { ok: true });

    expect(runExecution.handleJobComplete).toHaveBeenCalledTimes(1);
    expect(runExecution.handleJobComplete).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      { ok: true },
    );
  });

  it('emits WORKFLOW_RUN_PAUSED_EVENT with the new PENDING status', async () => {
    const { service, runRepo, eventEmitter } = createEngine();

    runRepo.update.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.PENDING,
      state_variables: { trigger: {} },
    });

    await service.pauseWorkflow('run-1');

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      'workflow.run.paused',
      expect.objectContaining({
        workflowRunId: 'run-1',
        workflowId: 'wf-1',
        status: WorkflowStatus.PENDING,
      }),
    );
  });

  it('emits WORKFLOW_RUN_RESUMED_EVENT and re-enqueues the current step on resume', async () => {
    const {
      service,
      runRepo,
      eventEmitter,
      runExecution,
      workflowDefinitionLoader,
    } = createEngine();

    runRepo.findById.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.PENDING,
      current_step_id: 'job-1',
      state_variables: { trigger: {} },
    });
    runRepo.update.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      state_variables: { trigger: {} },
    });

    const persistence = (service as unknown as { persistence: any })
      .persistence;
    const originalGetWorkflow = persistence.getWorkflow.bind(persistence);
    persistence.getWorkflow = vi.fn().mockResolvedValue({
      id: 'wf-1',
      yaml_definition: 'workflow_id: wf_1\nname: WF 1',
    });
    workflowDefinitionLoader.loadExecutableDefinition.mockResolvedValueOnce({
      workflow_id: 'wf_1',
      name: 'WF 1',
      jobs: [{ id: 'job-1' }],
    });

    try {
      await service.resumeWorkflow('run-1');

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        'workflow.run.resumed',
        expect.objectContaining({
          workflowRunId: 'run-1',
          workflowId: 'wf-1',
          status: WorkflowStatus.RUNNING,
        }),
      );
      expect(runExecution.enqueueJob).toHaveBeenCalledTimes(1);
      expect(runExecution.enqueueJob).toHaveBeenCalledWith(
        'run-1',
        expect.objectContaining({ workflow_id: 'wf_1' }),
        'job-1',
      );
    } finally {
      persistence.getWorkflow = originalGetWorkflow;
    }
  });

  it('does not emit RESUMED or re-enqueue when run is not PENDING', async () => {
    const { service, runRepo, eventEmitter, runExecution } = createEngine();

    runRepo.findById.mockResolvedValueOnce({
      id: 'run-1',
      workflow_id: 'wf-1',
      status: WorkflowStatus.RUNNING,
      current_step_id: 'job-1',
      state_variables: { trigger: {} },
    });

    await service.resumeWorkflow('run-1');

    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(runExecution.enqueueJob).not.toHaveBeenCalled();
  });

  it('delegates resumeJobWithMessage to the job message queue', async () => {
    const { service, jobMessageQueue } = createEngine();

    const result = await service.resumeJobWithMessage(
      'run-1',
      'session-1',
      'go',
    );

    expect(result).toBe('job-1');
    expect(jobMessageQueue.resumeJobWithMessage).toHaveBeenCalledTimes(1);
  });

  it('delegates retryJobWithMessage to the job message queue', async () => {
    const { service, jobMessageQueue } = createEngine();

    await service.retryJobWithMessage(
      'run-1',
      'job-1',
      { id: 'job-1', type: 'execution' } as any,
      'session-1',
      'retry',
    );

    expect(jobMessageQueue.retryJobWithMessage).toHaveBeenCalledTimes(1);
  });
});
