import { describe, expect, it, vi } from 'vitest';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { WorkflowRunAwaitingInputListener } from './workflow-run-awaiting-input.listener';

describe('WorkflowRunAwaitingInputListener', () => {
  const createListener = () => {
    const runRepo = { setAwaitingInput: vi.fn().mockResolvedValue(undefined) };
    const mockQuestionAwaits = {
      recordPosed: vi.fn().mockResolvedValue(undefined),
      cancelForRun: vi.fn().mockResolvedValue(undefined),
    };
    const listener = new WorkflowRunAwaitingInputListener(
      runRepo as unknown as IWorkflowRunRepository,
      mockQuestionAwaits as never,
    );
    return { listener, runRepo, mockQuestionAwaits };
  };

  it('flags the run as awaiting input when questions are posed', async () => {
    const { listener, runRepo } = createListener();

    await listener.handleQuestionsPosed({ workflowRunId: 'run-1' });

    expect(runRepo.setAwaitingInput).toHaveBeenCalledWith('run-1', true);
  });

  it('clears the awaiting-input flag when answers are submitted', async () => {
    const { listener, runRepo } = createListener();

    await listener.handleQuestionsAnswered({ workflowRunId: 'run-1' });

    expect(runRepo.setAwaitingInput).toHaveBeenCalledWith('run-1', false);
  });

  it('ignores events without a workflowRunId', async () => {
    const { listener, runRepo } = createListener();

    await listener.handleQuestionsPosed({});

    expect(runRepo.setAwaitingInput).not.toHaveBeenCalled();
  });

  it('does not block awaiting_input when recordPosed rejects', async () => {
    const { listener, runRepo, mockQuestionAwaits } = createListener();
    mockQuestionAwaits.recordPosed.mockRejectedValue(new Error('db error'));

    await expect(
      listener.handleQuestionsPosed({
        workflowRunId: 'run-1',
        stepId: 'step-1',
      }),
    ).resolves.toBeUndefined();

    expect(runRepo.setAwaitingInput).toHaveBeenCalledWith('run-1', true);
  });
});
