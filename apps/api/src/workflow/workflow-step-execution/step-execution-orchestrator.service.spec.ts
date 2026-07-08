import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi, Mock } from 'vitest';
import { StepExecutionOrchestratorService } from './step-execution-orchestrator.service';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import { StepEventPublisherService } from './step-event-publisher.service';
import { StepSupportService } from './step-support.service';
import { StepSpecialStepExecutorService } from '../workflow-special-steps/step-special-step-executor.service';
import { StepAgentStepExecutorService } from './step-agent-step-executor.service';
import { CapabilityPreflightService } from '../../tool/capability-preflight.service';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import { ExecutionOwnerLeaseService } from '../../execution-lifecycle/execution-owner-lease.service';
import { StepSessionCheckpointRepository } from '../workflow-session-checkpoint/step-session-checkpoint.repository';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import { WorkflowStatus } from '@nexus/core';

describe('StepExecutionOrchestratorService', () => {
  let service: StepExecutionOrchestratorService;
  let runRepo: { findById: Mock };
  let eventPublisher: { createEvent: Mock; publishBestEffort: Mock };
  let specialExecutor: { executeSpecialStep: Mock };
  let agentExecutor: { executeJob: Mock };
  let capabilityPreflight: { preflightJobExecution: Mock };
  let runExecution: { handleJobFailed: Mock };
  let executionRepo: {
    create: Mock;
    applyTransition: Mock;
    findByWorkflowRunAndJob: Mock;
  };
  let executionEventPublisher: {
    created: Mock;
    provisioning: Mock;
    completed: Mock;
    failed: Mock;
  };
  let executionOwnerLease: { claim: Mock };
  let subagentOrchestrator: { cancelActiveForParent: Mock };

  beforeEach(async () => {
    runRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'run-1',
        status: WorkflowStatus.RUNNING,
        state_variables: {},
      }),
    };
    eventPublisher = {
      createEvent: vi.fn((eventType: string, payload: unknown) => ({
        event_type: eventType,
        payload,
        timestamp: new Date().toISOString(),
      })),
      publishBestEffort: vi.fn().mockResolvedValue(undefined),
    };
    specialExecutor = {
      executeSpecialStep: vi.fn().mockResolvedValue(null),
    };
    agentExecutor = {
      executeJob: vi.fn().mockResolvedValue({ status: 'completed' }),
    };
    capabilityPreflight = {
      preflightJobExecution: vi.fn().mockResolvedValue({
        ok: true,
        workflowRunId: 'run-1',
        jobId: 'exec-1',
        scope_id: null,
        mode: null,
        callableToolNames: [],
        denied: [],
        approvalRequiredToolNames: [],
      }),
    };
    runExecution = {
      handleJobFailed: vi.fn().mockResolvedValue(undefined),
    };
    executionRepo = {
      create: vi.fn().mockResolvedValue({ id: 'exec-uuid-1' }),
      applyTransition: vi.fn().mockResolvedValue(null),
      findByWorkflowRunAndJob: vi.fn().mockResolvedValue([]),
    };
    executionEventPublisher = {
      created: vi.fn().mockResolvedValue(undefined),
      provisioning: vi.fn().mockResolvedValue(undefined),
      completed: vi.fn().mockResolvedValue(undefined),
      failed: vi.fn().mockResolvedValue(undefined),
    };
    executionOwnerLease = {
      claim: vi.fn().mockResolvedValue({
        claimed: true,
        stop: vi.fn().mockResolvedValue(undefined),
      }),
    };
    subagentOrchestrator = {
      cancelActiveForParent: vi
        .fn()
        .mockResolvedValue({ cancelled_execution_ids: [] }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepExecutionOrchestratorService,
        {
          provide: HarnessProviderRegistryService,
          useValue: new HarnessProviderRegistryService(),
        },
        {
          provide: WORKFLOW_RUN_REPOSITORY_PORT,
          useValue: runRepo,
        },
        {
          provide: StepEventPublisherService,
          useValue: eventPublisher,
        },
        {
          provide: StepSupportService,
          useValue: {
            resolveJobInputs: vi.fn(
              (inputs: Record<string, unknown>) => inputs ?? {},
            ),
          },
        },
        { provide: StepSpecialStepExecutorService, useValue: specialExecutor },
        { provide: StepAgentStepExecutorService, useValue: agentExecutor },
        {
          provide: CapabilityPreflightService,
          useValue: capabilityPreflight,
        },
        {
          provide: WorkflowRunJobExecutionService,
          useValue: runExecution,
        },
        {
          provide: ExecutionRepository,
          useValue: executionRepo,
        },
        {
          provide: ExecutionEventPublisher,
          useValue: executionEventPublisher,
        },
        {
          provide: ExecutionOwnerLeaseService,
          useValue: executionOwnerLease,
        },
        {
          provide: StepSessionCheckpointRepository,
          useValue: { findLatest: vi.fn().mockResolvedValue(null) },
        },
        {
          provide: HarnessProviderRegistryService,
          useValue: {
            getCapabilitiesForRef: vi.fn().mockReturnValue({
              resumeMechanism: 'config_ref',
            }),
          },
        },
        {
          provide: SubagentOrchestratorService,
          useValue: subagentOrchestrator,
        },
      ],
    }).compile();

    service = module.get(StepExecutionOrchestratorService);
  });

  it('returns special-step result when handled by special executor', async () => {
    specialExecutor.executeSpecialStep.mockResolvedValueOnce({
      status: 'completed',
      mode: 'tool_registration',
      toolId: 'tool-1',
    });

    const result = await service.executeJob(
      {
        workflowRunId: 'run-1',
        jobId: 'register-1',
        job: {
          id: 'register-1',
          type: 'register_tool',
          tier: 'light',
          steps: [],
        },
      },
      'bull-job-1',
    );

    expect(result).toEqual({
      status: 'completed',
      mode: 'tool_registration',
      toolId: 'tool-1',
    });
    expect(agentExecutor.executeJob).not.toHaveBeenCalled();
  });

  it('delegates to agent executor when special executor does not handle step', async () => {
    const result = await service.executeJob(
      {
        workflowRunId: 'run-1',
        jobId: 'exec-1',
        job: {
          id: 'exec-1',
          type: 'execution',
          tier: 'light',
          steps: [{ id: 'step-1', prompt: 'Test prompt' }],
        },
      },
      'bull-job-1',
    );

    expect(agentExecutor.executeJob).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'exec-1',
      }),
      'bull-job-1',
      {},
      {},
    );
    expect(result).toEqual({ status: 'completed' });
  });

  it('fails fast when capability preflight fails', async () => {
    capabilityPreflight.preflightJobExecution.mockResolvedValueOnce({
      ok: false,
      workflowRunId: 'run-1',
      jobId: 'exec-1',
      scope_id: 'project-1',
      mode: 'notifications_only',
      callableToolNames: [],
      denied: [
        {
          toolName: 'create_tool_candidate',
          reasonCode: 'mode_denied',
          reason: 'Mode denies mutating actions',
        },
      ],
      approvalRequiredToolNames: [],
      reasonCode: 'required_tool_not_callable',
      message: 'Required tool create_tool_candidate is not callable',
      failedTool: 'create_tool_candidate',
      remediation: 'Switch to supervised mode',
    });

    const result = await service.executeJob(
      {
        workflowRunId: 'run-1',
        jobId: 'exec-1',
        job: {
          id: 'exec-1',
          type: 'execution',
          tier: 'light',
          output_contract: {
            required: ['decision'],
          },
          steps: [{ id: 'step-1', prompt: 'Test prompt' }],
        },
      },
      'bull-job-1',
    );

    expect(result).toEqual(
      expect.objectContaining({
        skipped: true,
        reason: 'capability_preflight_failed',
      }),
    );
    expect(runExecution.handleJobFailed).toHaveBeenCalledWith(
      'run-1',
      'exec-1',
      'Required tool create_tool_candidate is not callable',
    );
    expect(agentExecutor.executeJob).not.toHaveBeenCalled();
  });

  it('skips queued jobs when workflow run no longer exists', async () => {
    runRepo.findById.mockResolvedValueOnce(null);

    const result = await service.executeJob(
      {
        workflowRunId: 'missing-run',
        jobId: 'exec-1',
        job: {
          id: 'exec-1',
          type: 'execution',
          tier: 'light',
          steps: [{ id: 'step-1', prompt: 'Test prompt' }],
        },
      },
      'bull-job-1',
    );

    expect(result).toEqual({ skipped: true, reason: 'run_not_found' });
    expect(eventPublisher.publishBestEffort).not.toHaveBeenCalled();
    expect(agentExecutor.executeJob).not.toHaveBeenCalled();
  });

  it('skips queued jobs when workflow run is not running', async () => {
    runRepo.findById.mockResolvedValueOnce({
      id: 'run-1',
      status: WorkflowStatus.FAILED,
      state_variables: {},
    });

    const result = await service.executeJob(
      {
        workflowRunId: 'run-1',
        jobId: 'exec-1',
        job: {
          id: 'exec-1',
          type: 'execution',
          tier: 'light',
          steps: [{ id: 'step-1', prompt: 'Test prompt' }],
        },
      },
      'bull-job-1',
    );

    expect(result).toEqual({
      skipped: true,
      reason: 'run_not_running',
      runStatus: WorkflowStatus.FAILED,
    });
    expect(eventPublisher.publishBestEffort).not.toHaveBeenCalled();
    expect(agentExecutor.executeJob).not.toHaveBeenCalled();
  });

  it('skips job when condition evaluates to false', async () => {
    (service as any).support.resolveJobInputs.mockReturnValueOnce({
      condition: 'false',
    });

    const result = await service.executeJob(
      {
        workflowRunId: 'run-1',
        jobId: 'exec-1',
        job: {
          id: 'exec-1',
          type: 'execution',
          tier: 'light',
          condition: '{{#if someFalseCondition}}true{{else}}false{{/if}}',
          steps: [{ id: 'step-1', prompt: 'Test prompt' }],
        },
      },
      'bull-job-1',
    );

    expect(result).toEqual({ skipped: true, reason: 'condition_false' });
    expect(agentExecutor.executeJob).not.toHaveBeenCalled();
  });

  describe('dispatchJob background execution lifecycle', () => {
    const agentJobData = {
      workflowRunId: 'run-1',
      jobId: 'exec-1',
      job: {
        id: 'exec-1',
        type: 'execution',
        tier: 'light',
        steps: [{ id: 'step-1', prompt: 'Test prompt' }],
      },
    };

    it('publishes execution.provisioning before the agent runs', async () => {
      const result = await service.dispatchJob(agentJobData, 'bull-job-1');

      expect(result).toEqual(expect.objectContaining({ dispatched: true }));
      await vi.waitFor(() => {
        expect(executionEventPublisher.provisioning).toHaveBeenCalled();
        expect(agentExecutor.executeJob).toHaveBeenCalled();
      });
      const provisioningOrder =
        executionEventPublisher.provisioning.mock.invocationCallOrder[0];
      const executeOrder = agentExecutor.executeJob.mock.invocationCallOrder[0];
      expect(provisioningOrder).toBeLessThan(executeOrder);
    });

    it('claims an owner lease before dispatching the background workflow step', async () => {
      await service.dispatchJob(agentJobData, 'bull-job-1');

      await vi.waitFor(() => {
        expect(executionOwnerLease.claim).toHaveBeenCalledWith(
          expect.any(String),
        );
        expect(agentExecutor.executeJob).toHaveBeenCalled();
      });
      const claimOrder = executionOwnerLease.claim.mock.invocationCallOrder[0];
      const executeOrder = agentExecutor.executeJob.mock.invocationCallOrder[0];
      expect(claimOrder).toBeLessThan(executeOrder);
    });

    it('fails the execution when owner lease cannot be claimed', async () => {
      executionOwnerLease.claim.mockResolvedValueOnce({
        claimed: false,
        stop: vi.fn(),
      });

      await service.dispatchJob(agentJobData, 'bull-job-1');

      await vi.waitFor(() => {
        expect(executionEventPublisher.failed).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            failure_reason: 'agent_error',
            error_message: 'Execution owner lease could not be claimed',
          }),
        );
      });
      expect(executionEventPublisher.provisioning).not.toHaveBeenCalled();
      expect(agentExecutor.executeJob).not.toHaveBeenCalled();
    });

    it('stops the owner lease after background execution completes', async () => {
      const stop = vi.fn().mockResolvedValue(undefined);
      executionOwnerLease.claim.mockResolvedValueOnce({
        claimed: true,
        stop,
      });

      await service.dispatchJob(agentJobData, 'bull-job-1');

      await vi.waitFor(() => {
        expect(stop).toHaveBeenCalled();
      });
    });

    it('publishes execution.completed on success', async () => {
      await service.dispatchJob(agentJobData, 'bull-job-1');

      await vi.waitFor(() => {
        expect(executionEventPublisher.completed).toHaveBeenCalled();
      });
      expect(executionEventPublisher.failed).not.toHaveBeenCalled();
    });

    it('publishes execution.failed when the agent execution throws', async () => {
      agentExecutor.executeJob.mockRejectedValueOnce(
        new Error('socket hang up'),
      );

      await service.dispatchJob(agentJobData, 'bull-job-1');

      await vi.waitFor(() => {
        expect(executionEventPublisher.failed).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            failure_reason: 'agent_error',
            error_message: 'socket hang up',
          }),
        );
      });
      expect(executionEventPublisher.completed).not.toHaveBeenCalled();
    });

    it('strips NUL bytes from the error_message before publishing execution.failed', async () => {
      const NUL = String.fromCharCode(0);
      agentExecutor.executeJob.mockRejectedValueOnce(
        new Error(`health check timed out${NUL}${NUL}npm warn`),
      );

      await service.dispatchJob(agentJobData, 'bull-job-1');

      await vi.waitFor(() => {
        expect(executionEventPublisher.failed).toHaveBeenCalled();
      });
      const payload = executionEventPublisher.failed.mock.calls[0][1] as {
        error_message: string;
      };
      expect(payload.error_message.includes(NUL)).toBe(false);
      expect(payload.error_message).toContain('health check timed out');
    });

    it('retries publishing execution.failed with a safe message when the first publish throws', async () => {
      agentExecutor.executeJob.mockRejectedValueOnce(new Error('boom'));
      executionEventPublisher.failed
        .mockRejectedValueOnce(new Error('unsupported Unicode escape sequence'))
        .mockResolvedValueOnce(undefined);

      await service.dispatchJob(agentJobData, 'bull-job-1');

      await vi.waitFor(() => {
        expect(executionEventPublisher.failed).toHaveBeenCalledTimes(2);
      });
      const fallback = executionEventPublisher.failed.mock.calls[1][1] as {
        failure_reason: string;
        error_message: string;
      };
      expect(fallback.failure_reason).toBe('agent_error');
      expect(typeof fallback.error_message).toBe('string');
    });

    it('supersedes prior non-terminal executions for the same run and job before dispatching', async () => {
      executionRepo.findByWorkflowRunAndJob.mockResolvedValueOnce([
        { id: 'old-exec-1', state: 'running' },
        { id: 'old-exec-2', state: 'completed' },
        { id: 'old-exec-3', state: 'pending' },
      ]);

      await service.dispatchJob(agentJobData, 'bull-job-1');

      expect(executionRepo.findByWorkflowRunAndJob).toHaveBeenCalledWith(
        'run-1',
        'exec-1',
      );
      expect(executionRepo.applyTransition).toHaveBeenCalledWith(
        'old-exec-1',
        'cancelled',
        expect.objectContaining({ failure_reason: 'superseded' }),
      );
      expect(executionRepo.applyTransition).toHaveBeenCalledWith(
        'old-exec-3',
        'cancelled',
        expect.objectContaining({ failure_reason: 'superseded' }),
      );
      expect(executionRepo.applyTransition).not.toHaveBeenCalledWith(
        'old-exec-2',
        'cancelled',
        expect.anything(),
      );
    });

    it('cancels in-flight subagents of the superseded attempt before dispatching the retry', async () => {
      executionRepo.findByWorkflowRunAndJob.mockResolvedValueOnce([
        { id: 'e1', state: 'running', container_id: 'c1' },
      ]);
      subagentOrchestrator.cancelActiveForParent.mockResolvedValue({
        cancelled_execution_ids: ['s1'],
      });

      await service.dispatchJob(agentJobData, 'bull-job-1');

      expect(subagentOrchestrator.cancelActiveForParent).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({ workflowRunId: 'run-1' }),
      );
    });
  });
});
