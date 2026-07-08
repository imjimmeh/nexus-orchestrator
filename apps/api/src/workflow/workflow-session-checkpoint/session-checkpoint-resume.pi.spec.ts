/**
 * Integration-level regression test: PI checkpoint resume orchestration wiring.
 *
 * SCOPE: This test covers the ORCHESTRATION LOGIC only — no real Docker
 * container is involved. It verifies that when a PI step is re-dispatched after
 * a reap, the orchestrator reads the persisted checkpoint, threads
 * `resumeSessionTreeId` into the data payload that flows to the agent executor,
 * and that already-completed jobs are NOT resumed.
 *
 * Container-level reap → resume fidelity (the injected session.jsonl actually
 * being used by the PI engine inside the container) is covered by the Phase 6
 * deterministic E2E (Task 17).
 */

import { Test, TestingModule } from '@nestjs/testing';
import {
  describe,
  beforeEach,
  afterEach,
  it,
  expect,
  vi,
  type Mock,
} from 'vitest';
import { StepExecutionOrchestratorService } from '../workflow-step-execution/step-execution-orchestrator.service';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import { StepEventPublisherService } from '../workflow-step-execution/step-event-publisher.service';
import { StepSupportService } from '../workflow-step-execution/step-support.service';
import { StepSpecialStepExecutorService } from '../workflow-special-steps/step-special-step-executor.service';
import { StepAgentStepExecutorService } from '../workflow-step-execution/step-agent-step-executor.service';
import { CapabilityPreflightService } from '../../tool/capability-preflight.service';
import { WorkflowRunJobExecutionService } from '../workflow-run-job-execution.service';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import { ExecutionOwnerLeaseService } from '../../execution-lifecycle/execution-owner-lease.service';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import { StepSessionCheckpointRepository } from './step-session-checkpoint.repository';
import { HarnessProviderRegistryService } from '../../harness/harness-provider-registry.service';
import { WorkflowStatus } from '@nexus/core';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

/**
 * Drains the microtask queue and pending timers so fire-and-forget async chains
 * (like `void runAgentJobAndPublishResult(...)` in the orchestrator) complete
 * before assertions run.
 */
function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal agent executor mock that captures the data it receives. */
function createCapturingAgentExecutor() {
  const capturedData: unknown[] = [];
  const executeJob = vi.fn(async (data: unknown) => {
    capturedData.push(data);
    return { status: 'dispatched' };
  });
  return { executeJob, capturedData };
}

/** Minimal PI checkpoint row fixture (session_ref carries a treeId). */
function buildPiCheckpoint(treeId: string) {
  return {
    engine: 'pi',
    session_ref: { kind: 'pi', treeId },
    resume_node_id: null,
    call_seq: 5,
    phase: 'result',
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('PI checkpoint resume — orchestration wiring (integration)', () => {
  let service: StepExecutionOrchestratorService;
  let checkpointRepo: { findLatest: Mock };
  let agentCapture: ReturnType<typeof createCapturingAgentExecutor>;

  const WORKFLOW_RUN_ID = 'run-pi-resume-1';
  const JOB_ID = 'job-pi-resume-1';
  const CHECKPOINT_TREE_ID = 'tree-uuid-from-reap';

  const STANDARD_JOB = {
    id: JOB_ID,
    type: 'execution' as const,
    tier: 'light' as const,
    steps: [{ id: 'step-1', prompt: 'Continue the task.' }],
  };

  /**
   * Builds a NestJS TestingModule for StepExecutionOrchestratorService.
   *
   * @param workflowRunOverride - Partial override for the WorkflowRunRepository
   *   `findById` resolved value. Merges with the default fixture so tests only
   *   need to supply the fields that differ (e.g. `state_variables`).
   */
  async function buildTestModule(
    workflowRunOverride?: Partial<{
      id: string;
      status: unknown;
      state_variables: Record<string, unknown>;
    }>,
  ): Promise<TestingModule> {
    const defaultWorkflowRun = {
      id: WORKFLOW_RUN_ID,
      status: WorkflowStatus.RUNNING,
      state_variables: {},
    };

    return Test.createTestingModule({
      providers: [
        StepExecutionOrchestratorService,
        {
          provide: HarnessProviderRegistryService,
          useValue: new HarnessProviderRegistryService(),
        },
        {
          provide: WORKFLOW_RUN_REPOSITORY_PORT,
          useValue: {
            findById: vi.fn().mockResolvedValue({
              ...defaultWorkflowRun,
              ...workflowRunOverride,
            }),
          },
        },
        {
          provide: StepEventPublisherService,
          useValue: {
            createEvent: vi.fn((type: string, payload: unknown) => ({
              event_type: type,
              payload,
            })),
            publishBestEffort: vi.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: StepSupportService,
          useValue: {
            resolveJobInputs: vi.fn((inputs: unknown) => inputs ?? {}),
          },
        },
        {
          provide: StepSpecialStepExecutorService,
          useValue: { executeSpecialStep: vi.fn().mockResolvedValue(null) },
        },
        {
          provide: StepAgentStepExecutorService,
          useValue: agentCapture,
        },
        {
          provide: CapabilityPreflightService,
          useValue: {
            preflightJobExecution: vi.fn().mockResolvedValue({
              ok: true,
              workflowRunId: WORKFLOW_RUN_ID,
              jobId: JOB_ID,
              scope_id: null,
              mode: null,
              callableToolNames: [],
              denied: [],
              approvalRequiredToolNames: [],
            }),
          },
        },
        {
          provide: WorkflowRunJobExecutionService,
          useValue: { handleJobFailed: vi.fn().mockResolvedValue(undefined) },
        },
        {
          provide: ExecutionRepository,
          useValue: {
            create: vi.fn().mockResolvedValue({ id: 'exec-pi-new' }),
            applyTransition: vi.fn().mockResolvedValue(null),
            findByWorkflowRunAndJob: vi.fn().mockResolvedValue([]),
          },
        },
        {
          provide: ExecutionEventPublisher,
          useValue: {
            created: vi.fn().mockResolvedValue(undefined),
            provisioning: vi.fn().mockResolvedValue(undefined),
            completed: vi.fn().mockResolvedValue(undefined),
            failed: vi.fn().mockResolvedValue(undefined),
          },
        },
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
          useValue: new HarnessProviderRegistryService(),
        },
        {
          provide: SubagentOrchestratorService,
          useValue: {
            spawn: vi.fn(),
            waitForSubagents: vi.fn(),
            checkStatus: vi.fn(),
            cancelExecution: vi.fn(),
            cancelActiveForParent: vi.fn(),
            handleCompletion: vi.fn(),
          },
        },
      ],
    }).compile();
  }

  beforeEach(async () => {
    vi.stubEnv('SESSION_CHECKPOINT_RESUME_ENABLED', 'true');

    agentCapture = createCapturingAgentExecutor();
    checkpointRepo = {
      findLatest: vi.fn(),
    };

    const module = await buildTestModule();
    service = module.get(StepExecutionOrchestratorService);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('threads resumeSessionTreeId when a PI checkpoint exists for the (run, job) pair', async () => {
    // Arrange: checkpoint row with a fresh PI treeId (written by the supervisor reap path)
    checkpointRepo.findLatest.mockResolvedValue(
      buildPiCheckpoint(CHECKPOINT_TREE_ID),
    );

    await service.dispatchJob(
      { workflowRunId: WORKFLOW_RUN_ID, jobId: JOB_ID, job: STANDARD_JOB },
      'bull-1',
    );
    // Drain the microtask queue so the fire-and-forget background execution completes.
    await flushPromises();

    // The agent executor must have been called with a data payload that carries
    // the treeId so the container retry will inject that session.
    expect(agentCapture.executeJob).toHaveBeenCalled();
    const calledData = agentCapture.executeJob.mock.calls[0][0] as {
      resumeSessionTreeId?: string;
      resumeSessionRef?: unknown;
    };
    expect(calledData.resumeSessionTreeId).toBe(CHECKPOINT_TREE_ID);
    expect(calledData.resumeSessionRef).toEqual({
      kind: 'pi',
      treeId: CHECKPOINT_TREE_ID,
    });
  });

  it('does NOT thread resumeSessionTreeId when the job is already in completed_jobs', async () => {
    // Arrange: checkpoint exists BUT the job is already marked complete in state
    checkpointRepo.findLatest.mockResolvedValue(
      buildPiCheckpoint(CHECKPOINT_TREE_ID),
    );

    const module = await buildTestModule({
      state_variables: {
        _internal: { completed_jobs: { [JOB_ID]: true } },
      },
    });
    const serviceWithCompletedJob = module.get(
      StepExecutionOrchestratorService,
    );

    await serviceWithCompletedJob.dispatchJob(
      { workflowRunId: WORKFLOW_RUN_ID, jobId: JOB_ID, job: STANDARD_JOB },
      'bull-2',
    );
    await flushPromises();

    // completed_jobs guard must prevent checkpoint resume injection
    expect(agentCapture.executeJob).toHaveBeenCalled();
    const calledData = agentCapture.executeJob.mock.calls[0][0] as {
      resumeSessionTreeId?: string;
      resumeSessionRef?: unknown;
    };
    expect(calledData.resumeSessionTreeId).toBeUndefined();
    expect(calledData.resumeSessionRef).toBeUndefined();
  });

  it('does NOT thread resumeSessionTreeId when no checkpoint row exists', async () => {
    // Arrange: no checkpoint (first-time dispatch, not a reap)
    checkpointRepo.findLatest.mockResolvedValue(null);

    await service.dispatchJob(
      { workflowRunId: WORKFLOW_RUN_ID, jobId: JOB_ID, job: STANDARD_JOB },
      'bull-3',
    );
    await flushPromises();

    expect(agentCapture.executeJob).toHaveBeenCalled();
    const calledData = agentCapture.executeJob.mock.calls[0][0] as {
      resumeSessionTreeId?: string;
    };
    expect(calledData.resumeSessionTreeId).toBeUndefined();
  });
});
