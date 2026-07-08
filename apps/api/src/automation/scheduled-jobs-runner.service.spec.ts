import { ScheduledJobRunStatus } from '@nexus/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledJob } from './database/entities/scheduled-job.entity';
import type { ScheduledJobRun } from './database/entities/scheduled-job-run.entity';
import type { ScheduledJobRepository } from './database/repositories/scheduled-job.repository';
import type { ScheduledJobRunRepository } from './database/repositories/scheduled-job-run.repository';
import type { ScheduleExpressionService } from './schedule-expression.service';
import { ScheduledJobsRunnerService } from './scheduled-jobs-runner.service';
import type { IWorkflowEngineService } from '../workflow/kernel/interfaces/workflow-kernel.ports';

describe('ScheduledJobsRunnerService', () => {
  const SCOPE_ID = '458935f0-213e-4bbe-89d1-8883e0efa9ad';
  const JOB_ID = 'job-1';
  const RUN_ID = 'run-1';
  const WORKFLOW_RUN_ID = 'wf-run-1';

  const startWorkflow = vi.fn();
  const runRepoCreate = vi.fn();
  const runRepoUpdate = vi.fn();

  const jobRepository = {} as unknown as ScheduledJobRepository;
  const runRepository = {
    create: runRepoCreate,
    update: runRepoUpdate,
  } as unknown as ScheduledJobRunRepository;
  const scheduleExpressionService = {} as unknown as ScheduleExpressionService;
  const workflowEngineService = {
    startWorkflow,
  } as unknown as IWorkflowEngineService;

  let service: ScheduledJobsRunnerService;

  const job = {
    id: JOB_ID,
    scopeId: SCOPE_ID,
    execution_target_ref: 'nightly_ci_qa',
    payload_json: { foo: 'bar' },
  } as unknown as ScheduledJob;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-19T06:00:00.000Z'));

    runRepoCreate.mockResolvedValue({
      id: RUN_ID,
    });
    runRepoUpdate.mockResolvedValue({
      id: RUN_ID,
      status: ScheduledJobRunStatus.RUNNING,
    });
    startWorkflow.mockResolvedValue(WORKFLOW_RUN_ID);

    service = new ScheduledJobsRunnerService(
      jobRepository,
      runRepository,
      scheduleExpressionService,
      workflowEngineService,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts the workflow with a flat trigger context so {{ trigger.scopeId }} resolves', async () => {
    await service.runScheduledJobNow(job);

    expect(startWorkflow).toHaveBeenCalledTimes(1);
    const [targetRef, triggerData] = startWorkflow.mock.calls[0];

    expect(targetRef).toBe('nightly_ci_qa');
    // The engine wraps triggerData under a `trigger` key, so these fields must
    // live at the top level of triggerData for {{ trigger.scopeId }} to resolve.
    expect(triggerData).toMatchObject({
      event: 'scheduled.job',
      source: 'manual',
      scopeId: SCOPE_ID,
      scheduledJobId: JOB_ID,
      scheduledRunId: RUN_ID,
      dueAt: '2026-06-19T06:00:00.000Z',
    });
    // Must NOT be double-nested under trigger.trigger.
    expect((triggerData as Record<string, unknown>).trigger).toBeUndefined();
  });

  it('preserves the scheduled job payload under trigger.payload', async () => {
    await service.runScheduledJobNow(job);

    const [, triggerData] = startWorkflow.mock.calls[0];
    expect((triggerData as Record<string, unknown>).payload).toEqual({
      foo: 'bar',
    });
  });

  it('passes null scopeId for non-project schedules without nesting', async () => {
    await service.runScheduledJobNow({
      ...job,
      scopeId: null,
    });

    const [, triggerData] = startWorkflow.mock.calls[0];
    expect((triggerData as Record<string, unknown>).scopeId).toBeNull();
    expect((triggerData as Record<string, unknown>).trigger).toBeUndefined();
  });
});
