import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, afterEach, describe, expect, it, vi, Mock } from 'vitest';
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
import {
  WorkflowStatus,
  PI_CAPABILITIES,
  CLAUDE_CODE_CAPABILITIES,
} from '@nexus/core';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import type { JobQueueData } from './step-execution.types';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';

describe('StepExecutionOrchestratorService — checkpoint resume threading', () => {
  let service: StepExecutionOrchestratorService;
  let checkpointRepo: { findLatest: Mock; hasResultFor: Mock };
  let agentExecutor: { executeJob: Mock };
  let runRepo: { findById: Mock };
  let specialExecutor: { executeSpecialStep: Mock };
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
  let eventPublisher: { createEvent: Mock; publishBestEffort: Mock };
  let harnessRegistry: { getCapabilitiesForRef: Mock };

  /** A minimal agent job fixture — neutral ids, execution type. */
  const makeJobData = (
    overrides: Partial<JobQueueData> = {},
  ): JobQueueData => ({
    workflowRunId: 'run-abc',
    jobId: 'job-xyz',
    job: {
      id: 'job-xyz',
      type: 'execution',
      tier: 'light',
      steps: [{ id: 'step-1', prompt: 'Do the thing' }],
    },
    ...overrides,
  });

  beforeEach(async () => {
    vi.stubEnv('SESSION_CHECKPOINT_RESUME_ENABLED', 'true');

    checkpointRepo = {
      findLatest: vi.fn().mockResolvedValue(null),
      hasResultFor: vi.fn().mockResolvedValue(false),
    };

    runRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'run-abc',
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
    specialExecutor = { executeSpecialStep: vi.fn().mockResolvedValue(null) };
    agentExecutor = {
      executeJob: vi.fn().mockResolvedValue({ status: 'completed' }),
    };
    capabilityPreflight = {
      preflightJobExecution: vi.fn().mockResolvedValue({
        ok: true,
        workflowRunId: 'run-abc',
        jobId: 'job-xyz',
        scope_id: null,
        mode: null,
        callableToolNames: [],
        denied: [],
        approvalRequiredToolNames: [],
      }),
    };
    runExecution = { handleJobFailed: vi.fn().mockResolvedValue(undefined) };
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

    harnessRegistry = {
      getCapabilitiesForRef: vi.fn((ref: { kind: string }) => {
        const kind = ref.kind;
        if (kind === 'pi') return PI_CAPABILITIES;
        if (kind === 'custom:my-harness') {
          return {
            ...PI_CAPABILITIES,
            resumeMechanism: 'file_injection' as const,
          };
        }
        if (kind === 'claude_code') return CLAUDE_CODE_CAPABILITIES;
        throw new Error(`Unsupported harness ref kind: ${kind}`);
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StepExecutionOrchestratorService,
        {
          provide: HarnessProviderRegistryService,
          useValue: new HarnessProviderRegistryService(),
        },
        { provide: WORKFLOW_RUN_REPOSITORY_PORT, useValue: runRepo },
        { provide: StepEventPublisherService, useValue: eventPublisher },
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
        { provide: CapabilityPreflightService, useValue: capabilityPreflight },
        { provide: WorkflowRunJobExecutionService, useValue: runExecution },
        { provide: ExecutionRepository, useValue: executionRepo },
        { provide: ExecutionEventPublisher, useValue: executionEventPublisher },
        {
          provide: ExecutionOwnerLeaseService,
          useValue: {
            claim: vi.fn().mockResolvedValue({
              claimed: true,
              stop: vi.fn().mockResolvedValue(undefined),
            }),
          },
        },
        {
          provide: StepSessionCheckpointRepository,
          useValue: checkpointRepo,
        },
        {
          provide: HarnessProviderRegistryService,
          useValue: harnessRegistry,
        },
        {
          provide: SubagentOrchestratorService,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get(StepExecutionOrchestratorService);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // -------------------------------------------------------------------------
  // Case 1 — PI checkpoint: threads resumeSessionTreeId + resumeSessionRef
  // -------------------------------------------------------------------------
  it('threads the latest pi checkpoint resume ref into the redispatch queue data', async () => {
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: { kind: 'pi', treeId: 't9', resumeNodeId: 'n4' },
      resume_node_id: 'n4',
      engine: 'pi',
      phase: 'result',
      call_seq: 4,
    });

    await service.dispatchJob(makeJobData(), 'bull-1');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionTreeId).toBe('t9');
    expect(passedData.resumeSessionRef).toEqual({
      kind: 'pi',
      treeId: 't9',
      resumeNodeId: 'n4',
    });
  });

  // -------------------------------------------------------------------------
  // Case 2 — claude-code checkpoint: threads resumeSessionRef only
  // -------------------------------------------------------------------------
  it('threads resumeSessionRef for a claude-code checkpoint', async () => {
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: { kind: 'claude_code', sessionId: 'sid1' },
      resume_node_id: null,
      engine: 'claude-code',
      phase: 'result',
      call_seq: 2,
    });

    await service.dispatchJob(makeJobData(), 'bull-2');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionRef).toEqual({
      kind: 'claude_code',
      sessionId: 'sid1',
    });
    expect(passedData.resumeSessionTreeId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Case 3 — custom file_injection harness: threads resumeSessionTreeId + resumeSessionRef
  // -------------------------------------------------------------------------
  it('threads resumeSessionTreeId for custom file_injection harness', async () => {
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: { kind: 'custom:my-harness', treeId: 't-custom' } as any,
      engine: 'custom:my-harness' as any,
      phase: 'result',
      call_seq: 1,
    });

    await service.dispatchJob(makeJobData(), 'bull-custom');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionTreeId).toBe('t-custom');
    expect(passedData.resumeSessionRef).toEqual({
      kind: 'custom:my-harness',
      treeId: 't-custom',
    });
  });

  // -------------------------------------------------------------------------
  // Case 4 — no checkpoint: starts fresh (no resume fields added)
  // -------------------------------------------------------------------------
  it('starts fresh when there is no checkpoint', async () => {
    checkpointRepo.findLatest.mockResolvedValueOnce(null);

    await service.dispatchJob(makeJobData(), 'bull-3');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionRef).toBeUndefined();
    expect(passedData.resumeSessionTreeId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Case 4 — job already completed: checkpoint NOT consulted
  // -------------------------------------------------------------------------
  it('does not consult the checkpoint repository when the job is already completed', async () => {
    runRepo.findById.mockResolvedValueOnce({
      id: 'run-abc',
      status: WorkflowStatus.RUNNING,
      state_variables: {
        _internal: { completed_jobs: { 'job-xyz': true } },
      },
    });

    await service.dispatchJob(makeJobData(), 'bull-4');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    expect(checkpointRepo.findLatest).not.toHaveBeenCalled();

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionRef).toBeUndefined();
    expect(passedData.resumeSessionTreeId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Case 5 — caller already set a resume ref: existing ref is preserved
  // -------------------------------------------------------------------------
  it('does not override an existing resume ref already present in queue data', async () => {
    const existingRef = {
      kind: 'claude_code' as const,
      sessionId: 'pre-existing',
    };
    const dataWithRef = makeJobData({ resumeSessionTreeId: 'pre-tree' });
    dataWithRef.resumeSessionRef = existingRef;

    // Would return a different ref if consulted
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: { kind: 'claude_code', sessionId: 'new-session' },
      engine: 'claude-code',
      phase: 'result',
      call_seq: 1,
    });

    await service.dispatchJob(dataWithRef, 'bull-5');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    // The checkpoint repo should NOT have been consulted
    expect(checkpointRepo.findLatest).not.toHaveBeenCalled();

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionRef).toEqual(existingRef);
    expect(passedData.resumeSessionTreeId).toBe('pre-tree');
  });

  // -------------------------------------------------------------------------
  // Case 6 — checkpoint with null session_ref: no resume fields set
  // -------------------------------------------------------------------------
  it('starts fresh when the checkpoint exists but session_ref is null', async () => {
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: null,
      resume_node_id: null,
      engine: 'pi',
      phase: 'intent',
      call_seq: 1,
    });

    await service.dispatchJob(makeJobData(), 'bull-6');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionRef).toBeUndefined();
    expect(passedData.resumeSessionTreeId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Case 8 — in-flight tool: surfaces a warning note in userMessage
  // -------------------------------------------------------------------------
  it('surfaces an in-flight tool note when the latest checkpoint is intent without a result', async () => {
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: { kind: 'pi', treeId: 't1', resumeNodeId: 'n1' },
      resume_node_id: 'n1',
      engine: 'pi',
      phase: 'intent',
      call_seq: 5,
      tool_name: 'http.post',
    });
    checkpointRepo.hasResultFor.mockResolvedValueOnce(false);

    await service.dispatchJob(makeJobData(), 'bull-8');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.userMessage).toBeDefined();
    expect(passedData.userMessage).toContain('http.post');
    expect(passedData.userMessage).toContain('5');
    expect(passedData.userMessage?.toLowerCase()).toMatch(/unknown|verify/);
  });

  // -------------------------------------------------------------------------
  // Case 9 — latest checkpoint is a result: no note added
  // -------------------------------------------------------------------------
  it('does NOT add a note when the latest checkpoint is a result', async () => {
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: { kind: 'pi', treeId: 't2', resumeNodeId: 'n2' },
      resume_node_id: 'n2',
      engine: 'pi',
      phase: 'result',
      call_seq: 5,
      tool_name: 'http.post',
    });
    // hasResultFor not expected to be called in this branch

    await service.dispatchJob(makeJobData(), 'bull-9');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.userMessage).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Case 10 — no checkpoint: no note added
  // -------------------------------------------------------------------------
  it('does NOT add a note when there is no checkpoint', async () => {
    checkpointRepo.findLatest.mockResolvedValueOnce(null);

    await service.dispatchJob(makeJobData(), 'bull-10');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.userMessage).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Case 11 — existing userMessage preserved: in-flight note does not override
  // -------------------------------------------------------------------------
  it('does not override an existing userMessage when an in-flight tool is detected', async () => {
    const existingMessage = 'Resume from durable-await: child completed.';
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: { kind: 'pi', treeId: 't3', resumeNodeId: 'n3' },
      resume_node_id: 'n3',
      engine: 'pi',
      phase: 'intent',
      call_seq: 7,
      tool_name: 'data.fetch',
    });
    checkpointRepo.hasResultFor.mockResolvedValueOnce(false);

    await service.dispatchJob(
      makeJobData({ userMessage: existingMessage }),
      'bull-11',
    );

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.userMessage).toBe(existingMessage);
  });

  // -------------------------------------------------------------------------
  // Case 12 — auto-retry with resumeSessionTreeId: honours the retry resume ref
  // -------------------------------------------------------------------------
  it('uses autoRetry.resume.resumeSessionTreeId when present (PI resume on retry)', async () => {
    const data = makeJobData({
      autoRetry: {
        attempt: 2,
        retryQueueJobId: 'rq-1',
        resume: { resumeSessionTreeId: 'tree-from-retry' },
      },
    });

    await service.dispatchJob(data, 'bull-1');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionTreeId).toBe('tree-from-retry');
  });

  // -------------------------------------------------------------------------
  // Case 13 — auto-retry with resumeSessionRef: honours the retry resume ref (claude_code resume)
  // -------------------------------------------------------------------------
  it('uses autoRetry.resume.resumeSessionRef when present (claude_code resume on retry)', async () => {
    const sessionRef = { kind: 'claude_code' as const, sessionId: 'sess-abc' };
    const data = makeJobData({
      autoRetry: {
        attempt: 2,
        retryQueueJobId: 'rq-1',
        resume: { resumeSessionRef: sessionRef },
      },
    });

    await service.dispatchJob(data, 'bull-1');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionRef).toEqual(sessionRef);
    expect(passedData.resumeSessionTreeId).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Case 7 — feature flag OFF: checkpoint repo is never consulted
  // -------------------------------------------------------------------------
  it('does not consult the checkpoint repository when SESSION_CHECKPOINT_RESUME_ENABLED is off', async () => {
    // Override the describe-level stub: turn flag OFF for this test
    vi.stubEnv('SESSION_CHECKPOINT_RESUME_ENABLED', 'false');

    // Would return a checkpoint if consulted
    checkpointRepo.findLatest.mockResolvedValueOnce({
      session_ref: { kind: 'claude_code', sessionId: 'should-not-appear' },
      engine: 'claude-code',
      phase: 'result',
      call_seq: 1,
    });

    await service.dispatchJob(makeJobData(), 'bull-7');

    await vi.waitFor(() => {
      expect(agentExecutor.executeJob).toHaveBeenCalled();
    });

    // The repo must NOT have been consulted
    expect(checkpointRepo.findLatest).not.toHaveBeenCalled();

    const passedData = agentExecutor.executeJob.mock
      .calls[0][0] as JobQueueData;
    expect(passedData.resumeSessionRef).toBeUndefined();
    expect(passedData.resumeSessionTreeId).toBeUndefined();
  });
});
