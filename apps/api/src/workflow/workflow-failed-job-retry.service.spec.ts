import { WorkflowStatus } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import { WorkflowFailedJobRetryService } from './workflow-failed-job-retry.service';

function createService() {
  const workflowRepo = { findById: vi.fn(), findByIdentifier: vi.fn() };
  workflowRepo.findByIdentifier.mockImplementation((identifier: string) =>
    workflowRepo.findById(identifier),
  );
  const runRepo = { findById: vi.fn(), update: vi.fn() };
  const parser = { parseWorkflow: vi.fn() };
  const promptLoader = { resolveWorkflowPromptsWithRetry: vi.fn() };
  const jobMessageQueue = { retryJobWithMessage: vi.fn() };
  const service = new WorkflowFailedJobRetryService(
    workflowRepo as never,
    runRepo as never,
    parser as never,
    promptLoader as never,
    jobMessageQueue as never,
  );

  return {
    service,
    workflowRepo,
    runRepo,
    parser,
    promptLoader,
    jobMessageQueue,
  };
}

describe('WorkflowFailedJobRetryService', () => {
  it('marks the failed run running and retries the failed job with a repair prompt', async () => {
    const {
      service,
      workflowRepo,
      runRepo,
      parser,
      promptLoader,
      jobMessageQueue,
    } = createService();

    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'workflow-1',
      status: WorkflowStatus.FAILED,
      current_step_id: 'job-1',
    });
    workflowRepo.findById.mockResolvedValue({
      id: 'workflow-1',
      yaml_definition: 'workflow-yaml',
    });
    const definition = {
      jobs: [{ id: 'job-1', type: 'execution' }],
      permissions: { allow_tools: ['read'] },
    };
    parser.parseWorkflow.mockReturnValue(definition);
    promptLoader.resolveWorkflowPromptsWithRetry.mockReturnValue(definition);
    const calls: string[] = [];
    runRepo.update.mockImplementation(async () => {
      calls.push('update');
    });
    jobMessageQueue.retryJobWithMessage.mockImplementation(async () => {
      calls.push('retry');
    });

    const retried = await service.retryFailedJobWithMessage({
      workflowRunId: 'run-1',
      failedJobId: 'job-1',
      retryPrompt: 'Repair succeeded. Retry the job.',
      onRetryResolved: ({ failedJobId }) => {
        calls.push(`resolved:${failedJobId}`);
      },
    });

    expect(retried).toEqual({ retried: true, failedJobId: 'job-1' });
    expect(calls).toEqual(['resolved:job-1', 'update', 'retry']);
    expect(runRepo.update).toHaveBeenCalledWith('run-1', {
      status: WorkflowStatus.RUNNING,
      current_step_id: 'job-1',
    });
    expect(jobMessageQueue.retryJobWithMessage).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      definition.jobs[0],
      undefined,
      'Repair succeeded. Retry the job.',
      definition.permissions,
      undefined,
      undefined,
    );
  });

  it('carries workflow-level YAML skills into the retry payload', async () => {
    const {
      service,
      workflowRepo,
      runRepo,
      parser,
      promptLoader,
      jobMessageQueue,
    } = createService();

    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'workflow-1',
      status: WorkflowStatus.FAILED,
      current_step_id: 'job-1',
    });
    workflowRepo.findById.mockResolvedValue({
      id: 'workflow-1',
      yaml_definition: 'workflow-yaml',
    });
    const definition = {
      jobs: [{ id: 'job-1', type: 'execution' }],
      permissions: { allow_tools: ['read'] },
      skills: ['git-commit-discipline'],
    };
    parser.parseWorkflow.mockReturnValue(definition);
    promptLoader.resolveWorkflowPromptsWithRetry.mockReturnValue(definition);

    await service.retryFailedJobWithMessage({
      workflowRunId: 'run-1',
      failedJobId: 'job-1',
      retryPrompt: 'Repair succeeded. Retry the job.',
    });

    expect(jobMessageQueue.retryJobWithMessage).toHaveBeenCalledWith(
      'run-1',
      'job-1',
      definition.jobs[0],
      undefined,
      'Repair succeeded. Retry the job.',
      definition.permissions,
      undefined,
      definition.skills,
    );
  });

  it('loads legacy run workflow values by identifier before retrying failed jobs', async () => {
    const {
      service,
      workflowRepo,
      runRepo,
      parser,
      promptLoader,
      jobMessageQueue,
    } = createService();

    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'workflow_definition_id',
      status: WorkflowStatus.FAILED,
      current_step_id: 'job-1',
    });
    workflowRepo.findById.mockRejectedValue(
      new Error('invalid input syntax for type uuid: "workflow_definition_id"'),
    );
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: 'workflow-1',
      yaml_definition: 'workflow-yaml',
    });
    const definition = {
      jobs: [{ id: 'job-1', type: 'execution' }],
      permissions: { allow_tools: ['read'] },
    };
    parser.parseWorkflow.mockReturnValue(definition);
    promptLoader.resolveWorkflowPromptsWithRetry.mockReturnValue(definition);

    const retried = await service.retryFailedJobWithMessage({
      workflowRunId: 'run-1',
      failedJobId: 'job-1',
      retryPrompt: 'Repair succeeded. Retry the job.',
    });

    expect(retried).toEqual({ retried: true, failedJobId: 'job-1' });
    expect(workflowRepo.findByIdentifier).toHaveBeenCalledWith(
      'workflow_definition_id',
      { includeInactive: true },
    );
    expect(jobMessageQueue.retryJobWithMessage).toHaveBeenCalled();
  });

  it('restores the run to failed when retry queueing throws after marking running', async () => {
    const {
      service,
      workflowRepo,
      runRepo,
      parser,
      promptLoader,
      jobMessageQueue,
    } = createService();

    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'workflow-1',
      status: WorkflowStatus.FAILED,
      current_step_id: 'job-1',
    });
    workflowRepo.findById.mockResolvedValue({
      id: 'workflow-1',
      yaml_definition: 'workflow-yaml',
    });
    const definition = {
      jobs: [{ id: 'job-1', type: 'execution' }],
      permissions: { allow_tools: ['read'] },
    };
    parser.parseWorkflow.mockReturnValue(definition);
    promptLoader.resolveWorkflowPromptsWithRetry.mockReturnValue(definition);
    const queueError = new Error('Queue unavailable');
    jobMessageQueue.retryJobWithMessage.mockRejectedValue(queueError);

    await expect(
      service.retryFailedJobWithMessage({
        workflowRunId: 'run-1',
        failedJobId: 'job-1',
        retryPrompt: 'Repair succeeded. Retry the job.',
      }),
    ).rejects.toThrow(queueError);

    expect(runRepo.update).toHaveBeenNthCalledWith(1, 'run-1', {
      status: WorkflowStatus.RUNNING,
      current_step_id: 'job-1',
    });
    expect(runRepo.update).toHaveBeenNthCalledWith(
      2,
      'run-1',
      expect.objectContaining({
        status: WorkflowStatus.FAILED,
        current_step_id: 'job-1',
      }),
    );
  });

  it('returns false and does not retry when the original run is no longer failed', async () => {
    const { service, runRepo, workflowRepo, jobMessageQueue } = createService();

    runRepo.findById.mockResolvedValue({
      id: 'run-1',
      workflow_id: 'workflow-1',
      status: WorkflowStatus.COMPLETED,
      current_step_id: 'job-1',
    });

    const retried = await service.retryFailedJobWithMessage({
      workflowRunId: 'run-1',
      failedJobId: 'job-1',
      retryPrompt: 'Repair succeeded. Retry the job.',
    });

    expect(retried).toBe(false);
    expect(workflowRepo.findById).not.toHaveBeenCalled();
    expect(runRepo.update).not.toHaveBeenCalled();
    expect(jobMessageQueue.retryJobWithMessage).not.toHaveBeenCalled();
  });
});
