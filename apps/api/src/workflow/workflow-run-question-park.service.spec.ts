import { describe, expect, it, vi } from 'vitest';
import { WorkflowRunQuestionParkService } from './workflow-run-question-park.service';

const make = () => {
  const questionAwaitRepo = {
    findOpenByRunId: vi.fn().mockResolvedValue(null),
    cancelOpenForRun: vi.fn().mockResolvedValue(undefined),
  };
  const runRepo = {
    setAwaitingInput: vi.fn().mockResolvedValue(undefined),
  };
  const stateManager = {
    getVariable: vi.fn().mockResolvedValue(null),
  };
  const service = new WorkflowRunQuestionParkService(
    questionAwaitRepo as never,
    runRepo as never,
    stateManager as never,
  );
  return { service, questionAwaitRepo, runRepo, stateManager };
};

const run = (over: Record<string, unknown> = {}) =>
  ({ id: 'run-1', awaiting_input: false, wait_reason: null, ...over }) as never;

describe('WorkflowRunQuestionParkService.resolveParkedTurnEnd', () => {
  it('suspends on wait_reason without touching question state', async () => {
    const { service, questionAwaitRepo } = make();
    const action = await service.resolveParkedTurnEnd(
      run({ wait_reason: 'await_agent_workflow' }),
      'job-1',
    );
    expect(action).toBe('suspend');
    expect(questionAwaitRepo.cancelOpenForRun).not.toHaveBeenCalled();
  });

  it('completes a non-parked run', async () => {
    const { service } = make();
    expect(await service.resolveParkedTurnEnd(run(), 'job-1')).toBe('complete');
  });

  it('suspends when awaiting_input and no persisted output', async () => {
    const { service, questionAwaitRepo } = make();
    const action = await service.resolveParkedTurnEnd(
      run({ awaiting_input: true }),
      'job-1',
    );
    expect(action).toBe('suspend');
    expect(questionAwaitRepo.cancelOpenForRun).not.toHaveBeenCalled();
  });

  it('completes and clears stale state when awaiting_input but output persisted', async () => {
    const { service, questionAwaitRepo, runRepo, stateManager } = make();
    stateManager.getVariable.mockImplementation(
      async (_id: string, key: string) =>
        key === 'jobs.job-1.output' ? { done: true } : null,
    );
    const action = await service.resolveParkedTurnEnd(
      run({ awaiting_input: true }),
      'job-1',
    );
    expect(action).toBe('complete');
    expect(questionAwaitRepo.cancelOpenForRun).toHaveBeenCalledWith('run-1');
    expect(runRepo.setAwaitingInput).toHaveBeenCalledWith('run-1', false);
  });
});

describe('WorkflowRunQuestionParkService.isIdleQuestionTeardownTimeout', () => {
  it('true when transport timeout + awaiting_input + open question', async () => {
    const { service, questionAwaitRepo } = make();
    questionAwaitRepo.findOpenByRunId.mockResolvedValue({ id: 'a' });
    expect(
      await service.isIdleQuestionTeardownTimeout(
        true,
        run({ awaiting_input: true }),
      ),
    ).toBe(true);
  });

  it('false when no open question', async () => {
    const { service } = make();
    expect(
      await service.isIdleQuestionTeardownTimeout(
        true,
        run({ awaiting_input: true }),
      ),
    ).toBe(false);
  });

  it('false when not a transport timeout', async () => {
    const { service, questionAwaitRepo } = make();
    expect(
      await service.isIdleQuestionTeardownTimeout(
        false,
        run({ awaiting_input: true }),
      ),
    ).toBe(false);
    expect(questionAwaitRepo.findOpenByRunId).not.toHaveBeenCalled();
  });
});

describe('WorkflowRunQuestionParkService.clearOrphanedQuestionStateOnRetry', () => {
  it('cancels + clears when parked', async () => {
    const { service, questionAwaitRepo, runRepo } = make();
    await service.clearOrphanedQuestionStateOnRetry(
      run({ awaiting_input: true }),
    );
    expect(questionAwaitRepo.cancelOpenForRun).toHaveBeenCalledWith('run-1');
    expect(runRepo.setAwaitingInput).toHaveBeenCalledWith('run-1', false);
  });

  it('no-op when not parked', async () => {
    const { service, questionAwaitRepo } = make();
    await service.clearOrphanedQuestionStateOnRetry(run());
    expect(questionAwaitRepo.cancelOpenForRun).not.toHaveBeenCalled();
  });
});
