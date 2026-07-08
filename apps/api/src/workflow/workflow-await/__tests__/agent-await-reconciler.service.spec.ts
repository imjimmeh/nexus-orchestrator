import { Logger } from '@nestjs/common';
import type { WorkflowStatus } from '@nexus/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentAwaitEntity } from '../agent-await.entity';
import { AgentAwaitRegistryService } from '../agent-await-registry.service';
import { AgentAwaitRepository } from '../agent-await.repository';
import { DependencyParentResumeService } from '../dependency-parent-resume.service';
import { IWorkflowRunRepository } from '../../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRunJobExecutionService } from '../../workflow-run-job-execution.service';
import { StepEventPublisherService } from '../../workflow-step-execution/step-event-publisher.service';
import {
  AgentAwaitReconcilerService,
  DEFAULT_RESUME_GRACE_MS,
  MAX_RESUME_ATTEMPTS,
} from '../agent-await-reconciler.service';

type AwaitRepoMock = Pick<
  AgentAwaitRepository,
  'findNonTerminal' | 'compareAndSetStatus' | 'findById'
>;
type RegistryMock = Pick<AgentAwaitRegistryService, 'onChildTerminal'>;
type ResumeMock = Pick<DependencyParentResumeService, 'resumeParent'>;
type RunRepoMock = Pick<IWorkflowRunRepository, 'findById' | 'clearWaitState'>;
type JobExecutionMock = Pick<WorkflowRunJobExecutionService, 'handleJobFailed'>;
type PublisherMock = Pick<StepEventPublisherService, 'publishProcessEvent'>;

const PARENT_RUN_ID = 'parent-run-1';
const PARENT_STEP_ID = 'step-1';
const CHILD_ONE = 'child-1';
const CHILD_TWO = 'child-2';

const FRESH = new Date('2026-06-12T12:00:00.000Z');
const STALE = new Date('2026-06-12T11:00:00.000Z');

const createAwait = (
  overrides: Partial<AgentAwaitEntity> = {},
): AgentAwaitEntity => ({
  id: 'await-1',
  parent_run_id: PARENT_RUN_ID,
  parent_step_id: PARENT_STEP_ID,
  parent_session_tree_id: 'tree-1',
  awaited_run_ids: [CHILD_ONE],
  satisfied_run_ids: [],
  status: 'WAITING',
  resume_node_id: null,
  created_at: FRESH,
  updated_at: FRESH,
  ...overrides,
});

const runWithStatus = (status: WorkflowStatus) =>
  ({ id: 'r', status }) as Awaited<
    ReturnType<IWorkflowRunRepository['findById']>
  >;

describe('AgentAwaitReconcilerService', () => {
  let awaitRepo: AwaitRepoMock;
  let registry: RegistryMock;
  let parentResume: ResumeMock;
  let runRepo: RunRepoMock;
  let jobExecution: JobExecutionMock;
  let publisher: PublisherMock;
  let service: AgentAwaitReconcilerService;

  const build = (): AgentAwaitReconcilerService =>
    new AgentAwaitReconcilerService(
      awaitRepo as AgentAwaitRepository,
      registry as AgentAwaitRegistryService,
      parentResume as DependencyParentResumeService,
      runRepo as IWorkflowRunRepository,
      jobExecution as WorkflowRunJobExecutionService,
      publisher as StepEventPublisherService,
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FRESH);

    awaitRepo = {
      findNonTerminal: vi.fn().mockResolvedValue([]),
      compareAndSetStatus: vi.fn().mockResolvedValue(true),
      findById: vi.fn().mockResolvedValue(null),
    };
    registry = {
      onChildTerminal: vi.fn().mockResolvedValue({ ready: null }),
    };
    parentResume = {
      resumeParent: vi.fn().mockResolvedValue(undefined),
    };
    runRepo = {
      findById: vi.fn().mockResolvedValue(null),
      clearWaitState: vi.fn().mockResolvedValue(undefined),
    };
    jobExecution = {
      handleJobFailed: vi.fn().mockResolvedValue('failed'),
    };
    publisher = {
      publishProcessEvent: vi.fn().mockResolvedValue(undefined),
    };

    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    service = build();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('resumes a WAITING await whose every child is terminal (lost-event recovery)', async () => {
    const record = createAwait({
      awaited_run_ids: [CHILD_ONE, CHILD_TWO],
    });
    awaitRepo.findNonTerminal = vi.fn().mockResolvedValue([record]);
    runRepo.findById = vi.fn().mockResolvedValue(runWithStatus('COMPLETED'));
    awaitRepo.compareAndSetStatus = vi.fn().mockResolvedValue(true);

    await service.reconcileOnce();

    expect(parentResume.resumeParent).toHaveBeenCalledOnce();
    expect(parentResume.resumeParent).toHaveBeenCalledWith(record);
    expect(awaitRepo.compareAndSetStatus).toHaveBeenCalledWith(
      record.id,
      'WAITING',
      'RESUMING',
    );
  });

  it('does not resume a WAITING await with a still-running child', async () => {
    const record = createAwait({
      awaited_run_ids: [CHILD_ONE, CHILD_TWO],
    });
    awaitRepo.findNonTerminal = vi.fn().mockResolvedValue([record]);
    runRepo.findById = vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(
          id === CHILD_ONE
            ? runWithStatus('COMPLETED')
            : runWithStatus('RUNNING'),
        ),
      );

    await service.reconcileOnce();

    expect(parentResume.resumeParent).not.toHaveBeenCalled();
    expect(awaitRepo.compareAndSetStatus).not.toHaveBeenCalledWith(
      record.id,
      'WAITING',
      'RESUMING',
    );
  });

  it('retries resumeParent for a RESUMING await older than the grace window', async () => {
    const record = createAwait({
      status: 'RESUMING',
      satisfied_run_ids: [{ runId: CHILD_ONE, status: 'COMPLETED' }],
      updated_at: STALE,
    });
    awaitRepo.findNonTerminal = vi.fn().mockResolvedValue([record]);

    await service.reconcileOnce();

    expect(parentResume.resumeParent).toHaveBeenCalledOnce();
    expect(parentResume.resumeParent).toHaveBeenCalledWith(record);
  });

  it('does not retry a RESUMING await within the grace window', async () => {
    const within = new Date(FRESH.getTime() - (DEFAULT_RESUME_GRACE_MS - 1000));
    const record = createAwait({
      status: 'RESUMING',
      satisfied_run_ids: [{ runId: CHILD_ONE, status: 'COMPLETED' }],
      updated_at: within,
    });
    awaitRepo.findNonTerminal = vi.fn().mockResolvedValue([record]);

    await service.reconcileOnce();

    expect(parentResume.resumeParent).not.toHaveBeenCalled();
  });

  it('cancels the await and fails the parent run after max resume attempts', async () => {
    const record = createAwait({
      status: 'RESUMING',
      satisfied_run_ids: [{ runId: CHILD_ONE, status: 'COMPLETED' }],
      updated_at: STALE,
    });
    awaitRepo.findNonTerminal = vi.fn().mockResolvedValue([record]);
    parentResume.resumeParent = vi
      .fn()
      .mockRejectedValue(new Error('resume boom'));

    for (let pass = 0; pass < MAX_RESUME_ATTEMPTS; pass += 1) {
      await service.reconcileOnce();
    }
    // The pass that exceeds the cap gives up rather than retrying.
    await service.reconcileOnce();

    expect(parentResume.resumeParent).toHaveBeenCalledTimes(
      MAX_RESUME_ATTEMPTS,
    );
    expect(awaitRepo.compareAndSetStatus).toHaveBeenCalledWith(
      record.id,
      'RESUMING',
      'CANCELLED',
    );
    expect(jobExecution.handleJobFailed).toHaveBeenCalledOnce();
    expect(jobExecution.handleJobFailed).toHaveBeenCalledWith(
      PARENT_RUN_ID,
      PARENT_STEP_ID,
      expect.stringContaining('await'),
    );
    expect(publisher.publishProcessEvent).toHaveBeenCalledWith(
      PARENT_RUN_ID,
      'agent_await.failed',
      expect.objectContaining({ awaitId: record.id }),
    );
  });
});
