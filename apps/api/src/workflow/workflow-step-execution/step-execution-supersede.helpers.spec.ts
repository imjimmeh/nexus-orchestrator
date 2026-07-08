import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { supersedePriorExecutions } from './step-execution-supersede.helpers';

describe('supersedePriorExecutions', () => {
  let executionRepo: {
    findByWorkflowRunAndJob: Mock;
    applyTransition: Mock;
  };

  beforeEach(() => {
    executionRepo = {
      findByWorkflowRunAndJob: vi.fn(),
      applyTransition: vi.fn().mockResolvedValue(null),
    };
  });

  it('returns superseded workflow_step container ids so callers can cancel their subagents', async () => {
    executionRepo.findByWorkflowRunAndJob.mockResolvedValue([
      { id: 'e1', state: 'running', container_id: 'c1' },
      { id: 'e2', state: 'completed', container_id: 'c2' }, // terminal — skipped
    ]);

    const containers = await supersedePriorExecutions({
      executionRepo,
      workflowRunId: 'r1',
      jobId: 'j1',
      log: () => {},
    });

    expect(containers).toEqual(['c1']);
    expect(executionRepo.applyTransition).toHaveBeenCalledWith(
      'e1',
      'cancelled',
      expect.anything(),
    );
  });

  it('returns an empty array when all prior executions are terminal', async () => {
    executionRepo.findByWorkflowRunAndJob.mockResolvedValue([
      { id: 'e1', state: 'completed', container_id: 'c1' },
      { id: 'e2', state: 'failed', container_id: 'c2' },
    ]);

    const containers = await supersedePriorExecutions({
      executionRepo,
      workflowRunId: 'r1',
      jobId: 'j1',
      log: () => {},
    });

    expect(containers).toEqual([]);
    expect(executionRepo.applyTransition).not.toHaveBeenCalled();
  });

  it('excludes executions without a container_id from the returned list', async () => {
    executionRepo.findByWorkflowRunAndJob.mockResolvedValue([
      { id: 'e1', state: 'running', container_id: null },
      { id: 'e2', state: 'pending', container_id: 'c2' },
    ]);

    const containers = await supersedePriorExecutions({
      executionRepo,
      workflowRunId: 'r1',
      jobId: 'j1',
      log: () => {},
    });

    expect(containers).toEqual(['c2']);
    expect(executionRepo.applyTransition).toHaveBeenCalledTimes(2);
  });

  it('returns an empty array when there are no prior executions', async () => {
    executionRepo.findByWorkflowRunAndJob.mockResolvedValue([]);

    const containers = await supersedePriorExecutions({
      executionRepo,
      workflowRunId: 'r1',
      jobId: 'j1',
      log: () => {},
    });

    expect(containers).toEqual([]);
    expect(executionRepo.applyTransition).not.toHaveBeenCalled();
  });
});
