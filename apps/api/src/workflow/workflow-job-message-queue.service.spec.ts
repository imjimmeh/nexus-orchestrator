import { describe, expect, it, vi } from 'vitest';
import { WorkflowJobMessageQueueService } from './workflow-job-message-queue.service';

const DEF = {
  jobs: [
    { id: 'capture_charter' },
    { id: 'capture_charter_brownfield' },
    { id: 'refine_charter' },
  ],
};

function buildService(run: Record<string, unknown>) {
  const workflowRepo = {
    findById: vi.fn().mockResolvedValue({ yaml_definition: 'yaml' }),
  };
  const runRepo = {
    findById: vi.fn().mockResolvedValue(run),
    update: vi.fn().mockResolvedValue(undefined),
  };
  const parser = { parseWorkflow: vi.fn().mockReturnValue(DEF) };
  const promptLoader = {
    resolveWorkflowPromptsWithRetry: vi.fn().mockResolvedValue(DEF),
  };
  const stepQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const service = new WorkflowJobMessageQueueService(
    workflowRepo as never,
    runRepo as never,
    parser as never,
    promptLoader as never,
    stepQueue,
  );
  return { service, stepQueue };
}

describe('resumeJobWithMessage job selection', () => {
  const baseRun = {
    id: 'run-1',
    workflow_id: 'wf-1',
    current_step_id: 'capture_charter',
    state_variables: { _internal: { current_job_id: 'refine_charter' } },
  };

  it('uses an explicitly provided jobId', async () => {
    const { service, stepQueue } = buildService(baseRun);

    const jobId = await service.resumeJobWithMessage(
      'run-1',
      'tree-1',
      'answers',
      { jobId: 'refine_charter' },
    );

    expect(jobId).toBe('refine_charter');
    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({ jobId: 'refine_charter' }),
      expect.anything(),
    );
  });

  it('defaults to _internal.current_job_id over the stale current_step_id', async () => {
    const { service } = buildService(baseRun);

    const jobId = await service.resumeJobWithMessage('run-1', 'tree-1', 'msg');

    expect(jobId).toBe('refine_charter');
  });

  it('falls back to current_step_id when internal state is empty', async () => {
    const { service } = buildService({
      ...baseRun,
      state_variables: {},
    });

    const jobId = await service.resumeJobWithMessage('run-1', 'tree-1', 'msg');

    expect(jobId).toBe('capture_charter');
  });

  it('rejects an explicit jobId that is not in the workflow definition', async () => {
    const { service } = buildService(baseRun);

    await expect(
      service.resumeJobWithMessage('run-1', 'tree-1', 'msg', {
        jobId: 'nope',
      }),
    ).rejects.toThrow(/Cannot determine which job to resume/);
  });
});

describe('retryJobWithMessage skill threading', () => {
  it('carries workflowYamlSkills into the retry payload alongside workflowSkillDiscoveryMode', async () => {
    const { service, stepQueue } = buildService({});

    await service.retryJobWithMessage(
      'run-1',
      'capture_charter',
      { id: 'capture_charter' },
      'tree-1',
      'please retry',
      { allow_tools: ['read'] },
      'workflow',
      ['git-commit-discipline'],
    );

    expect(stepQueue.add).toHaveBeenCalledWith(
      'execute-job',
      expect.objectContaining({
        workflowRunId: 'run-1',
        jobId: 'capture_charter',
        workflowPermissions: { allow_tools: ['read'] },
        workflowSkillDiscoveryMode: 'workflow',
        workflowYamlSkills: ['git-commit-discipline'],
      }),
      expect.anything(),
    );
  });
});

describe('resumeJobWithMessage terminal-run guard', () => {
  const terminalRun = {
    id: 'run-1',
    workflow_id: 'wf-1',
    current_step_id: 'refine_charter',
    state_variables: {},
  };

  it.each(['CANCELLED', 'COMPLETED', 'FAILED'])(
    'refuses to resume a %s run: does not re-enqueue or flip status to RUNNING',
    async (status) => {
      const workflowRepo = {
        findById: vi.fn().mockResolvedValue({ yaml_definition: 'yaml' }),
      };
      const runRepo = {
        findById: vi.fn().mockResolvedValue({ ...terminalRun, status }),
        update: vi.fn().mockResolvedValue(undefined),
      };
      const parser = { parseWorkflow: vi.fn().mockReturnValue(DEF) };
      const promptLoader = {
        resolveWorkflowPromptsWithRetry: vi.fn().mockResolvedValue(DEF),
      };
      const stepQueue = { add: vi.fn().mockResolvedValue(undefined) };
      const service = new WorkflowJobMessageQueueService(
        workflowRepo as never,
        runRepo as never,
        parser as never,
        promptLoader as never,
        stepQueue,
      );

      await expect(
        service.resumeJobWithMessage('run-1', 'tree-1', 'msg'),
      ).rejects.toThrow(/terminal/i);

      expect(runRepo.update).not.toHaveBeenCalled();
      expect(stepQueue.add).not.toHaveBeenCalled();
    },
  );
});
