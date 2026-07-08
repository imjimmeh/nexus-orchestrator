import { describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import {
  WORKFLOW_RUN_COMPLETED_EVENT,
  WORKFLOW_RUN_STARTED_EVENT,
} from './workflow-events.constants';
import { WorkflowPersistenceService } from './workflow-persistence.service';
import { WorkflowConcurrencyManager } from './workflow-concurrency-manager.service';
import { WorkflowLaunchDedupeService } from './workflow-launch-dedupe.service';
import type { IWorkflowDefinition } from '@nexus/core';
import { WorkflowEngineLaunchOrchestratorService } from './workflow-engine-launch-orchestrator.service';
import type { IWorkflowCancellationCascadeService } from './kernel/interfaces/workflow-kernel.ports';

/**
 * Spec for the launch-orchestrator seam extracted from
 * `WorkflowEngineService` under the M3 refactor milestone.
 *
 * Builds only the surface the orchestrator actually consumes: persistence,
 * concurrency, DAG resolver, run execution, event emitter, launch dedupe,
 * variable resolver, and the cancellation cascade (for the concurrency
 * `cancel` branch). The orchestrator is tested in isolation — no
 * `WorkflowEngineService` import — and the engine's launch-path behavior
 * (engine spec) is now expressed as a delegation to this service.
 */
describe('WorkflowEngineLaunchOrchestratorService', () => {
  const createOrchestrator = (parserOverrides?: Record<string, unknown>) => {
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
      findPendingByScopeAndDedupeKey: vi.fn().mockResolvedValue(null),
      findPendingByScopeAndTrigger: vi.fn().mockResolvedValue(null),
      findOldestRunningByScope: vi.fn().mockResolvedValue(null),
      countActiveByScope: vi.fn().mockResolvedValue(0),
    };

    const dagResolver = {
      buildDependencyGraph: vi.fn().mockReturnValue(new Map()),
      findParallelJobs: vi.fn().mockReturnValue([]),
    };

    const parser = {
      parseWorkflow: vi.fn().mockReturnValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
        ...parserOverrides,
      }),
    };

    const validator = {
      validateAndThrow: vi.fn().mockResolvedValue(undefined),
    };
    const workflowDefinitionLoader = {
      loadExecutableDefinition: vi.fn().mockResolvedValue({
        workflow_id: 'wf_1',
        name: 'WF 1',
        jobs: [],
        ...parserOverrides,
      }),
    };
    const yamlValidator = {
      validateAndThrow: vi.fn(),
    };
    const eventLog = { appendBestEffort: vi.fn().mockResolvedValue(undefined) };
    const eventEmitter = { emit: vi.fn() };
    const runExecution = {
      enqueueJob: vi.fn().mockResolvedValue(undefined),
      handleJobComplete: vi.fn().mockResolvedValue(undefined),
      removeQueuedJobsForRun: vi.fn().mockResolvedValue(0),
    };
    const concurrencyPolicy = {
      checkAndApply: vi
        .fn()
        .mockResolvedValue({ action: 'proceed', concurrencyScope: 'global' }),
      resolveConcurrencyScope: vi.fn().mockReturnValue('global'),
    };
    const jobMessageQueue = {
      resumeJobWithMessage: vi.fn().mockResolvedValue('job-1'),
      retryJobWithMessage: vi.fn().mockResolvedValue(undefined),
    };

    const cancellationCascade: IWorkflowCancellationCascadeService = {
      cancelRun: vi.fn().mockResolvedValue(undefined),
    };

    const containerCleanup = {
      stopManagedContainersForRun: vi.fn().mockResolvedValue(0),
    };

    const repos = {
      workflows: {},
      runs: runRepo,
      agentProfiles: {},
    };

    const persistence = new WorkflowPersistenceService(
      repos as any,
      parser as any,
      validator as any,
      yamlValidator as any,
    );

    const concurrency = new WorkflowConcurrencyManager(
      concurrencyPolicy as any,
      runRepo as any,
      eventLog as any,
    );
    const launchDedupe = new WorkflowLaunchDedupeService(runRepo as any);

    const variableResolver = {
      resolveContext: vi.fn(async (scopeId: string | null) => ({ scopeId })),
    };

    const orchestrator = new WorkflowEngineLaunchOrchestratorService(
      persistence,
      concurrency,
      dagResolver as any,
      runExecution as any,
      eventEmitter as any,
      launchDedupe,
      cancellationCascade,
      variableResolver as any,
    );

    return {
      orchestrator,
      runRepo,
      eventLog,
      eventEmitter,
      runExecution,
      dagResolver,
      concurrencyPolicy,
      launchDedupe,
      cancellationCascade,
      containerCleanup,
      variableResolver,
    };
  };

  const defaultDefinition: IWorkflowDefinition = {
    workflow_id: 'wf_1',
    name: 'WF 1',
    jobs: [],
  };

  describe('launch-dedupe-with-launch-key', () => {
    it('reuses an existing run when launch dedupe key finds one', async () => {
      const { orchestrator, runRepo } = createOrchestrator();

      runRepo.findLatestByWorkflowAndDedupeKey.mockResolvedValueOnce({
        id: 'run-existing-1',
      });

      const runId = await orchestrator.startAndDedupRun(
        'wf-1',
        {
          dedupeKey:
            'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
        },
        defaultDefinition,
      );

      expect(runId).toBe('run-existing-1');
      expect(runRepo.findLatestByWorkflowAndDedupeKey).toHaveBeenCalledWith(
        'wf-1',
        'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
      );
      expect(runRepo.create).not.toHaveBeenCalled();
    });

    it('returns the existing run when a global workflow launch reuses the same static dedupe key', async () => {
      const { orchestrator, runRepo } = createOrchestrator();
      const triggerData = {
        event: 'ProjectOrchestrationCycleRequestedEvent',
        scopeId: 'project-1',
        contextId: '__orchestration_lifecycle__',
        source: 'orchestration_continuation_reconciler',
        reason: 'stale_reconciler',
        dedupeKey:
          'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
      };

      runRepo.findLatestByWorkflowAndDedupeKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'run-new-1' });

      const firstRunId = await orchestrator.startAndDedupRun(
        'wf-1',
        triggerData,
        defaultDefinition,
      );
      const secondRunId = await orchestrator.startAndDedupRun(
        'wf-1',
        triggerData,
        defaultDefinition,
      );

      expect(firstRunId).toBe('run-new-1');
      expect(secondRunId).toBe('run-new-1');
      expect(runRepo.create).toHaveBeenCalledTimes(1);
      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_id: 'wf-1',
          status: 'RUNNING',
          launch_dedupe_key:
            'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
        }),
      );
    });

    it('starts a fresh orchestration launch when stale wakeup dedupe keys rotate', async () => {
      const { orchestrator, runRepo } = createOrchestrator();

      const firstWindowTrigger = {
        event: 'ProjectOrchestrationCycleRequestedEvent',
        scopeId: 'project-1',
        contextId: '__orchestration_lifecycle__',
        source: 'orchestration_continuation_reconciler',
        reason: 'stale_reconciler',
        dedupeKey:
          'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler:window-1',
      };
      const nextWindowTrigger = {
        ...firstWindowTrigger,
        dedupeKey:
          'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler:window-2',
      };

      runRepo.create
        .mockResolvedValueOnce({
          id: 'run-window-1',
          state_variables: {},
        })
        .mockResolvedValueOnce({
          id: 'run-window-2',
          state_variables: {},
        });
      runRepo.findLatestByWorkflowAndDedupeKey
        .mockResolvedValueOnce(null) // window-1 first call
        .mockResolvedValueOnce({ id: 'run-window-1' }) // window-1 second call
        .mockResolvedValueOnce(null); // window-2 first call

      const firstRunId = await orchestrator.startAndDedupRun(
        'wf-1',
        firstWindowTrigger,
        defaultDefinition,
      );
      const duplicateRunId = await orchestrator.startAndDedupRun(
        'wf-1',
        firstWindowTrigger,
        defaultDefinition,
      );
      const nextRunId = await orchestrator.startAndDedupRun(
        'wf-1',
        nextWindowTrigger,
        defaultDefinition,
      );

      expect(firstRunId).toBe('run-window-1');
      expect(duplicateRunId).toBe('run-window-1');
      expect(nextRunId).toBe('run-window-2');
      expect(runRepo.create).toHaveBeenCalledTimes(2);
      expect(runRepo.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          launch_dedupe_key:
            'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler:window-1',
        }),
      );
      expect(runRepo.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          launch_dedupe_key:
            'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler:window-2',
        }),
      );
      expect(runRepo.findLatestByWorkflowAndDedupeKey).toHaveBeenCalledWith(
        'wf-1',
        firstWindowTrigger.dedupeKey,
      );
      expect(runRepo.findLatestByWorkflowAndDedupeKey).toHaveBeenCalledWith(
        'wf-1',
        nextWindowTrigger.dedupeKey,
      );
    });

    it('does not launch duplicate orchestration cycles for the same nested payload dedupe key', async () => {
      const { orchestrator, runRepo } = createOrchestrator();
      const triggerData = {
        event: 'ProjectOrchestrationCycleRequestedEvent',
        payload: {
          scopeId: 'project-1',
          contextId: '__orchestration_lifecycle__',
          source: 'orchestration_continuation_reconciler',
          reason: 'stale_reconciler',
          dedupeKey:
            'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
        },
        dedupeKey:
          'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
      };

      runRepo.findLatestByWorkflowAndDedupeKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'run-new-1' });

      await orchestrator.startAndDedupRun(
        'wf-1',
        triggerData,
        defaultDefinition,
      );
      await orchestrator.startAndDedupRun(
        'wf-1',
        triggerData,
        defaultDefinition,
      );

      expect(runRepo.create).toHaveBeenCalledTimes(1);
      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          launch_dedupe_key:
            'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
        }),
      );
    });

    it('returns an existing run when a launch dedupe unique conflict occurs', async () => {
      const { orchestrator, runRepo } = createOrchestrator();
      const triggerData = {
        event: 'ProjectOrchestrationCycleRequestedEvent',
        scopeId: 'project-1',
        dedupeKey:
          'project-orchestration-cycle:project-1:orchestration_continuation_reconciler:stale_reconciler',
      };

      runRepo.create.mockRejectedValueOnce(
        new Error('duplicate key value violates unique constraint'),
      );
      runRepo.findLatestByWorkflowAndDedupeKey.mockResolvedValueOnce({
        id: 'run-existing-1',
      });

      const runId = await orchestrator.startAndDedupRun(
        'wf-1',
        triggerData,
        defaultDefinition,
      );

      expect(runId).toBe('run-existing-1');
    });
  });

  describe('legacy trigger-context dedupe (no launch dedupe key)', () => {
    it('reuses an active run for the same workflow/event trigger context', async () => {
      const { orchestrator, runRepo } = createOrchestrator();

      runRepo.findActiveByTriggerContext.mockResolvedValueOnce({
        id: 'run-existing-1',
      });

      const runId = await orchestrator.startAndDedupRun(
        'wf-1',
        {
          event: 'external.resource.status_changed.v1',
          scopeId: 'project-1',
          contextId: 'item-1',
          status: 'in-review',
        },
        defaultDefinition,
      );

      expect(runId).toBe('run-existing-1');
      expect(runRepo.findActiveByTriggerContext).toHaveBeenCalledWith('wf-1', {
        event: 'external.resource.status_changed.v1',
        scopeId: 'project-1',
        contextId: 'item-1',
        status: 'in-review',
      });
      expect(runRepo.create).not.toHaveBeenCalled();
    });

    it('creates a new run when no active dedupe match exists', async () => {
      const { orchestrator, runRepo, eventEmitter } = createOrchestrator();

      runRepo.findActiveByTriggerContext.mockResolvedValueOnce(null);

      const triggerData = {
        event: 'external.resource.status_changed.v1',
        scopeId: 'project-1',
        contextId: 'item-1',
        status: 'in-progress',
      };

      runRepo.create.mockResolvedValueOnce({
        id: 'run-new-1',
        state_variables: { trigger: triggerData },
      });

      const runId = await orchestrator.startAndDedupRun(
        'wf-1',
        triggerData,
        defaultDefinition,
      );

      expect(runId).toBe('run-new-1');
      expect(runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_id: 'wf-1',
          status: WorkflowStatus.RUNNING,
          state_variables: {
            trigger: triggerData,
            vars: { scopeId: 'project-1' },
          },
        }),
      );
      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WORKFLOW_RUN_STARTED_EVENT,
        expect.objectContaining({
          workflowRunId: 'run-new-1',
          status: WorkflowStatus.RUNNING,
        }),
      );
    });
  });

  describe('concurrency policy', () => {
    it('returns null when concurrency policy says skip', async () => {
      const { runRepo } = createOrchestrator();

      const definitionWithSkip: IWorkflowDefinition = {
        ...defaultDefinition,
        concurrency: { max_runs: 1, on_conflict: 'skip' },
      };

      const ctx = createOrchestrator();
      ctx.concurrencyPolicy.checkAndApply.mockResolvedValue({ action: 'skip' });

      const runId = await ctx.orchestrator.startAndDedupRun(
        'wf-1',
        { scopeId: 'p1' },
        definitionWithSkip,
      );

      expect(runId).toBeNull();
      expect(runRepo.create).not.toHaveBeenCalled();
    });

    it('creates a PENDING run when concurrency policy says queue', async () => {
      const ctx = createOrchestrator();

      const definitionWithQueue: IWorkflowDefinition = {
        ...defaultDefinition,
        concurrency: { max_runs: 1, on_conflict: 'queue' },
      };

      ctx.concurrencyPolicy.checkAndApply.mockResolvedValue({
        action: 'queue',
        concurrencyScope: 'proj-abc',
      });

      ctx.runRepo.create.mockResolvedValue({
        id: 'run-queued-1',
        state_variables: {},
      });

      const runId = await ctx.orchestrator.startAndDedupRun(
        'wf-1',
        { scopeId: 'proj-abc' },
        definitionWithQueue,
      );

      expect(runId).toBe('run-queued-1');
      expect(ctx.runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_id: 'wf-1',
          status: 'PENDING',
          concurrency_scope: 'proj-abc',
        }),
      );
      expect(ctx.eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'workflow.queued',
        }),
      );
    });

    it('reuses an existing pending queued run for the same workflow scope and trigger', async () => {
      const ctx = createOrchestrator();

      const definitionWithQueue: IWorkflowDefinition = {
        ...defaultDefinition,
        concurrency: { max_runs: 1, on_conflict: 'queue' },
      };

      ctx.concurrencyPolicy.checkAndApply.mockResolvedValue({
        action: 'queue',
        concurrencyScope: 'proj-abc',
      });

      ctx.runRepo.findPendingByScopeAndTrigger = vi
        .fn()
        .mockResolvedValue({ id: 'run-pending-existing' });

      const triggerData = {
        scopeId: 'proj-abc',
        source: 'orchestration_continuation_reconciler',
        reason: 'stale_reconciler',
      };

      const runId = await ctx.orchestrator.startAndDedupRun(
        'wf-1',
        triggerData,
        definitionWithQueue,
      );

      expect(runId).toBe('run-pending-existing');
      expect(ctx.runRepo.create).not.toHaveBeenCalled();
      expect(ctx.eventLog.appendBestEffort).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'workflow.queue_coalesced',
        }),
      );
    });

    it('creates a RUNNING run with concurrency_scope when policy says proceed', async () => {
      const ctx = createOrchestrator();

      const definitionWithProceed: IWorkflowDefinition = {
        ...defaultDefinition,
        concurrency: { max_runs: 2, on_conflict: 'skip' },
      };

      ctx.concurrencyPolicy.checkAndApply.mockResolvedValue({
        action: 'proceed',
        concurrencyScope: 'proj-abc',
      });

      await ctx.orchestrator.startAndDedupRun(
        'wf-1',
        { scopeId: 'proj-abc' },
        definitionWithProceed,
      );

      expect(ctx.runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'RUNNING',
          concurrency_scope: 'proj-abc',
        }),
      );
    });

    it('cancels oldest running run when concurrency policy says cancel', async () => {
      const ctx = createOrchestrator();

      const definitionWithCancel: IWorkflowDefinition = {
        ...defaultDefinition,
        concurrency: { max_runs: 1, on_conflict: 'cancel_running' },
      };

      ctx.concurrencyPolicy.checkAndApply.mockResolvedValue({
        action: 'cancel',
        cancelRunId: 'run-old-1',
        concurrencyScope: 'proj-abc',
      });

      ctx.runRepo.findById.mockResolvedValue({
        id: 'run-old-1',
        workflow_id: 'wf-1',
        status: 'RUNNING',
        started_at: new Date('2026-06-19T09:00:00.000Z'),
        completed_at: null,
        state_variables: {},
      });

      await ctx.orchestrator.startAndDedupRun(
        'wf-1',
        { scopeId: 'proj-abc' },
        definitionWithCancel,
      );

      expect(ctx.cancellationCascade.cancelRun).toHaveBeenCalledTimes(1);
      expect(ctx.cancellationCascade.cancelRun).toHaveBeenCalledWith(
        'run-old-1',
        'concurrency_cancel_running',
      );
      expect(ctx.runRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'RUNNING',
          concurrency_scope: 'proj-abc',
        }),
      );
    });

    it('does not use concurrency path when no concurrency config', async () => {
      const { orchestrator, concurrencyPolicy } = createOrchestrator();

      await orchestrator.startAndDedupRun(
        'wf-1',
        {
          event: 'external.resource.status_changed.v1',
          scopeId: 'p1',
          contextId: 'wi-1',
          status: 'in-progress',
        },
        defaultDefinition,
      );

      expect(concurrencyPolicy.checkAndApply).not.toHaveBeenCalled();
    });
  });

  describe('immediate-complete path', () => {
    it('stamps completed_at on the immediate-complete path when a workflow has no jobs', async () => {
      const { orchestrator, runRepo } = createOrchestrator();

      runRepo.create.mockResolvedValueOnce({
        id: 'run-empty-1',
        state_variables: {},
      });
      runRepo.findById.mockResolvedValue({
        id: 'run-empty-1',
        workflow_id: 'wf-1',
        status: 'RUNNING',
        started_at: new Date('2026-06-19T09:00:00.000Z'),
        completed_at: null,
        state_variables: {},
      });

      await orchestrator.startAndDedupRun('wf-1', {}, defaultDefinition);

      const completedUpdate = runRepo.update.mock.calls.find(
        ([, data]: [string, Record<string, unknown>]) =>
          data.status === WorkflowStatus.COMPLETED,
      );
      expect(completedUpdate?.[1].status).toBe(WorkflowStatus.COMPLETED);
      expect(completedUpdate?.[1].completed_at).toBeInstanceOf(Date);
    });

    it('emits WORKFLOW_RUN_COMPLETED_EVENT on the immediate-complete path', async () => {
      const { orchestrator, eventEmitter } = createOrchestrator();

      await orchestrator.startAndDedupRun('wf-1', {}, defaultDefinition);

      expect(eventEmitter.emit).toHaveBeenCalledWith(
        WORKFLOW_RUN_COMPLETED_EVENT,
        expect.objectContaining({
          workflowRunId: 'run-new-1',
          status: WorkflowStatus.COMPLETED,
        }),
      );
    });
  });

  describe('initial job scheduling', () => {
    it('does not enqueue transition targets as startup jobs', async () => {
      const rootJob = {
        id: 'attempt_merge',
        type: 'execution',
        tier: 'light',
        transitions: [
          {
            condition: 'jobs.attempt_merge.output.ok == false',
            next: 'emit_failure',
          },
        ],
        steps: [],
      };
      const transitionTargetJob = {
        id: 'emit_failure',
        type: 'emit_event',
        tier: 'light',
        steps: [],
      };

      const ctx = createOrchestrator({
        jobs: [rootJob, transitionTargetJob],
      });
      ctx.dagResolver.findParallelJobs.mockReturnValue([
        ['attempt_merge', 'emit_failure'],
      ]);

      await ctx.orchestrator.startAndDedupRun(
        'wf-1',
        { scopeId: 'scope-1' },
        {
          ...defaultDefinition,
          jobs: [rootJob, transitionTargetJob],
        },
      );

      expect(ctx.runRepo.update).toHaveBeenCalledWith('run-new-1', {
        current_step_id: 'attempt_merge',
      });
      expect(ctx.runExecution.enqueueJob).toHaveBeenCalledTimes(1);
      expect(ctx.runExecution.enqueueJob).toHaveBeenCalledWith(
        'run-new-1',
        expect.objectContaining({ jobs: [rootJob, transitionTargetJob] }),
        'attempt_merge',
      );
    });
  });
});
