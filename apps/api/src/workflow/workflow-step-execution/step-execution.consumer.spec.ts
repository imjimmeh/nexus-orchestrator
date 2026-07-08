import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { StepExecutionConsumer } from './step-execution.consumer';
import { StepExecutionOrchestratorService } from './step-execution-orchestrator.service';
import { StepSupportService } from './step-support.service';
import { StepRequiredToolRetryService } from './step-required-tool-retry.service';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { WorkflowAutoRetryActivationGuardService } from './workflow-auto-retry-activation-guard.service';
import { ServiceLifecycleStateService } from '../../execution-lifecycle/service-lifecycle-state.service';

describe('StepExecutionConsumer', () => {
  let consumer: StepExecutionConsumer;
  const orchestrator = {
    dispatchJob: vi
      .fn()
      .mockResolvedValue({ dispatched: true, executionId: 'exec-1' }),
  };
  const runExecution = {
    handleJobFailed: vi.fn().mockResolvedValue(undefined),
  };
  const autoRetryActivationGuard = {
    shouldSkipStaleAutoRetryJob: vi.fn().mockResolvedValue(false),
    markAutoRetryActivated: vi.fn().mockResolvedValue(undefined),
  };
  const lifecycle = {
    phase: 'running',
    isAcceptingWork: vi.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepExecutionConsumer,
        { provide: StepExecutionOrchestratorService, useValue: orchestrator },
        { provide: ServiceLifecycleStateService, useValue: lifecycle },
        {
          provide: StepSupportService,
          useValue: {
            resolveInvokedWorkflowId: vi.fn(),
            applyPolicyToToolNames: vi.fn(),
            resolveAgentProfileFromStepInputs: vi.fn(),
            selectToolsForStep: vi.fn(),
            resolveAllowedToolNames: vi.fn(),
            buildUpstreamContext: vi.fn(),
            extractStructuredOutput: vi.fn(),
            resolveStepInputs: vi.fn(),
            resolveWorktreePathFromTrigger: vi.fn(),
          },
        },
        {
          provide: StepRequiredToolRetryService,
          useValue: { checkRequiredToolCallsAndRetry: vi.fn() },
        },
        { provide: WorkflowRunJobExecutionService, useValue: runExecution },
        {
          provide: WorkflowAutoRetryActivationGuardService,
          useValue: autoRetryActivationGuard,
        },
      ],
    }).compile();

    consumer = module.get(StepExecutionConsumer);
  });

  it('is defined', () => {
    expect(consumer).toBeDefined();
  });

  it('delegates process execution to orchestrator', async () => {
    const jobData = {
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution' as const,
        tier: 'light',
        steps: [{ id: 'step-1', prompt: 'Test' }],
      },
    };
    const job = {
      id: 'bull-job-1',
      data: jobData,
    } as never;

    const result = await consumer.process(job);

    expect(orchestrator.dispatchJob).toHaveBeenCalledWith(
      jobData,
      'bull-job-1',
    );
    expect(result).toEqual({ dispatched: true, executionId: 'exec-1' });
  });

  it('skips stale auto-retry jobs before delegating to orchestrator', async () => {
    autoRetryActivationGuard.shouldSkipStaleAutoRetryJob.mockResolvedValueOnce(
      true,
    );
    const jobData = {
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution' as const,
        tier: 'light',
        steps: [{ id: 'step-1', prompt: 'Test' }],
      },
      autoRetry: {
        attempt: 1,
        retryQueueJobId: 'auto-retry-run-1-job-1',
      },
    };
    const job = {
      id: 'auto-retry-run-1-job-1',
      data: jobData,
    } as never;

    await expect(consumer.process(job)).resolves.toEqual({
      skipped: true,
      reason: 'stale_auto_retry',
    });
    expect(orchestrator.dispatchJob).not.toHaveBeenCalled();
  });

  it('delegates matching auto-retry jobs to orchestrator', async () => {
    const jobData = {
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution' as const,
        tier: 'light',
        steps: [{ id: 'step-1', prompt: 'Test' }],
      },
      autoRetry: {
        attempt: 1,
        retryQueueJobId: 'auto-retry-run-1-job-1',
      },
    };
    const job = {
      id: 'auto-retry-run-1-job-1',
      data: jobData,
    } as never;

    await consumer.process(job);

    expect(
      autoRetryActivationGuard.shouldSkipStaleAutoRetryJob,
    ).toHaveBeenCalledWith({
      queueJobId: 'auto-retry-run-1-job-1',
      data: jobData,
    });
    expect(orchestrator.dispatchJob).toHaveBeenCalledWith(
      jobData,
      'auto-retry-run-1-job-1',
    );
    expect(
      autoRetryActivationGuard.markAutoRetryActivated,
    ).toHaveBeenCalledWith(jobData);
  });

  it('does not clear pending-retry markers for non-auto-retry jobs', async () => {
    const jobData = {
      workflowRunId: 'run-1',
      jobId: 'job-1',
      job: {
        id: 'job-1',
        type: 'execution' as const,
        tier: 'light',
        steps: [{ id: 'step-1', prompt: 'Test' }],
      },
    };
    const job = { id: 'workflow-step-run-1-job-1', data: jobData } as never;

    await consumer.process(job);

    expect(
      autoRetryActivationGuard.markAutoRetryActivated,
    ).not.toHaveBeenCalled();
  });

  it('marks run failed when job exhausts retries', async () => {
    await consumer.onFailed(
      {
        data: {
          workflowRunId: 'run-1',
          jobId: 'job-1',
        },
        attemptsMade: 3,
        opts: { attempts: 3 },
      },
      new Error('boom'),
    );

    expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      'boom',
    );
  });

  it('does not mark run failed before final retry', async () => {
    await consumer.onFailed(
      {
        data: {
          workflowRunId: 'run-1',
          jobId: 'job-1',
        },
        attemptsMade: 1,
        opts: { attempts: 3 },
      },
      new Error('transient'),
    );

    expect(runExecution.handleJobFailed).not.toHaveBeenCalled();
  });

  it('does not rethrow when failure finalization handler throws', async () => {
    runExecution.handleJobFailed.mockRejectedValueOnce(
      new Error('prompt resolution failed'),
    );

    await expect(
      consumer.onFailed(
        {
          data: {
            workflowRunId: 'run-1',
            jobId: 'job-1',
          },
          attemptsMade: 3,
          opts: { attempts: 3 },
        },
        new Error('boom'),
      ),
    ).resolves.toBeUndefined();
  });

  describe('lifecycle phases', () => {
    it('blocks when booting and proceeds once running', async () => {
      lifecycle.phase = 'booting';

      const jobData = {
        workflowRunId: 'run-1',
        jobId: 'job-1',
        job: {
          id: 'job-1',
          type: 'execution' as const,
          tier: 'light',
          steps: [{ id: 'step-1', prompt: 'Test' }],
        },
      };
      const job = { id: 'bull-job-1', data: jobData } as never;

      // Start processing the job in background
      const processPromise = consumer.process(job);

      // Give it a moment to enter the booting wait loop
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(orchestrator.dispatchJob).not.toHaveBeenCalled();

      // Change phase to running
      lifecycle.phase = 'running';

      const result = await processPromise;

      expect(orchestrator.dispatchJob).toHaveBeenCalled();
      expect(result).toEqual({ dispatched: true, executionId: 'exec-1' });
    });

    it('throws an error if not accepting work when not booting (e.g. draining)', async () => {
      lifecycle.phase = 'draining';
      lifecycle.isAcceptingWork.mockReturnValueOnce(false);

      const jobData = {
        workflowRunId: 'run-1',
        jobId: 'job-1',
        job: {
          id: 'job-1',
          type: 'execution' as const,
          tier: 'light',
          steps: [{ id: 'step-1', prompt: 'Test' }],
        },
      };
      const job = { id: 'bull-job-1', data: jobData } as never;

      await expect(consumer.process(job)).rejects.toThrow(
        'Service is not accepting work (phase: draining)',
      );
      expect(orchestrator.dispatchJob).not.toHaveBeenCalled();
    });
  });
});
