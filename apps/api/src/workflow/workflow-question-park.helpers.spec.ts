import { describe, expect, it, vi } from 'vitest';
import {
  resolveParkedTurnEnd,
  isIdleQuestionTeardownTimeout,
  clearOrphanedQuestionStateOnRetry,
} from './workflow-question-park.helpers';

const makeLogger = () => ({ log: vi.fn(), warn: vi.fn() });

describe('resolveParkedTurnEnd', () => {
  const base = {
    workflowRunId: 'run-1',
    jobId: 'refine_charter',
    getVariable: vi.fn().mockResolvedValue(null),
    cancelOpenAwaits: vi.fn().mockResolvedValue(undefined),
    clearAwaitingInput: vi.fn().mockResolvedValue(undefined),
  };

  it('suspends a durable dependency wait (wait_reason) without touching question state', async () => {
    const logger = makeLogger();
    const action = await resolveParkedTurnEnd({
      ...base,
      run: { wait_reason: 'await_agent_workflow', awaiting_input: false },
      logger,
    });
    expect(action).toBe('suspend');
    expect(base.cancelOpenAwaits).not.toHaveBeenCalled();
    expect(base.clearAwaitingInput).not.toHaveBeenCalled();
  });

  it('completes a normal (not parked) turn-end', async () => {
    const action = await resolveParkedTurnEnd({
      ...base,
      run: { wait_reason: null, awaiting_input: false },
      logger: makeLogger(),
    });
    expect(action).toBe('complete');
  });

  it('suspends when awaiting_input and no persisted output (genuine question park)', async () => {
    const getVariable = vi.fn().mockResolvedValue(null);
    const cancelOpenAwaits = vi.fn().mockResolvedValue(undefined);
    const clearAwaitingInput = vi.fn().mockResolvedValue(undefined);
    const action = await resolveParkedTurnEnd({
      workflowRunId: 'run-1',
      jobId: 'refine_charter',
      run: { wait_reason: null, awaiting_input: true },
      getVariable,
      cancelOpenAwaits,
      clearAwaitingInput,
      logger: makeLogger(),
    });
    expect(action).toBe('suspend');
    expect(cancelOpenAwaits).not.toHaveBeenCalled();
    expect(clearAwaitingInput).not.toHaveBeenCalled();
  });

  it('completes and clears stale state when awaiting_input but output was persisted', async () => {
    const getVariable = vi
      .fn()
      .mockImplementation(async (path: string) =>
        path === 'jobs.refine_charter.output'
          ? { charter_updated: true }
          : null,
      );
    const cancelOpenAwaits = vi.fn().mockResolvedValue(undefined);
    const clearAwaitingInput = vi.fn().mockResolvedValue(undefined);
    const action = await resolveParkedTurnEnd({
      workflowRunId: 'run-1',
      jobId: 'refine_charter',
      run: { wait_reason: null, awaiting_input: true },
      getVariable,
      cancelOpenAwaits,
      clearAwaitingInput,
      logger: makeLogger(),
    });
    expect(action).toBe('complete');
    expect(cancelOpenAwaits).toHaveBeenCalledWith('run-1');
    expect(clearAwaitingInput).toHaveBeenCalledWith('run-1');
  });

  it('prioritises wait_reason over awaiting_input', async () => {
    const cancelOpenAwaits = vi.fn().mockResolvedValue(undefined);
    const action = await resolveParkedTurnEnd({
      workflowRunId: 'run-1',
      jobId: 'j1',
      run: { wait_reason: 'await_agent_workflow', awaiting_input: true },
      getVariable: vi.fn().mockResolvedValue({ x: 1 }),
      cancelOpenAwaits,
      clearAwaitingInput: vi.fn().mockResolvedValue(undefined),
      logger: makeLogger(),
    });
    expect(action).toBe('suspend');
    expect(cancelOpenAwaits).not.toHaveBeenCalled();
  });
});

describe('isIdleQuestionTeardownTimeout', () => {
  it('returns false when not a transport timeout', async () => {
    const findOpenAwait = vi.fn().mockResolvedValue({ id: 'a' });
    const result = await isIdleQuestionTeardownTimeout({
      isTransportTimeout: false,
      awaitingInput: true,
      workflowRunId: 'run-1',
      findOpenAwait,
    });
    expect(result).toBe(false);
    expect(findOpenAwait).not.toHaveBeenCalled();
  });

  it('returns false when not awaiting input', async () => {
    const findOpenAwait = vi.fn().mockResolvedValue({ id: 'a' });
    const result = await isIdleQuestionTeardownTimeout({
      isTransportTimeout: true,
      awaitingInput: false,
      workflowRunId: 'run-1',
      findOpenAwait,
    });
    expect(result).toBe(false);
    expect(findOpenAwait).not.toHaveBeenCalled();
  });

  it('returns true when transport timeout while parked on an open question', async () => {
    const result = await isIdleQuestionTeardownTimeout({
      isTransportTimeout: true,
      awaitingInput: true,
      workflowRunId: 'run-1',
      findOpenAwait: vi.fn().mockResolvedValue({ id: 'a', status: 'pending' }),
    });
    expect(result).toBe(true);
  });

  it('returns false when transport timeout but no open question', async () => {
    const result = await isIdleQuestionTeardownTimeout({
      isTransportTimeout: true,
      awaitingInput: true,
      workflowRunId: 'run-1',
      findOpenAwait: vi.fn().mockResolvedValue(null),
    });
    expect(result).toBe(false);
  });
});

describe('clearOrphanedQuestionStateOnRetry', () => {
  it('cancels awaits and clears the flag when the run was parked', async () => {
    const cancelOpenAwaits = vi.fn().mockResolvedValue(undefined);
    const clearAwaitingInput = vi.fn().mockResolvedValue(undefined);
    await clearOrphanedQuestionStateOnRetry({
      awaitingInput: true,
      workflowRunId: 'run-1',
      cancelOpenAwaits,
      clearAwaitingInput,
    });
    expect(cancelOpenAwaits).toHaveBeenCalledWith('run-1');
    expect(clearAwaitingInput).toHaveBeenCalledWith('run-1');
  });

  it('is a no-op when the run was not parked', async () => {
    const cancelOpenAwaits = vi.fn().mockResolvedValue(undefined);
    const clearAwaitingInput = vi.fn().mockResolvedValue(undefined);
    await clearOrphanedQuestionStateOnRetry({
      awaitingInput: false,
      workflowRunId: 'run-1',
      cancelOpenAwaits,
      clearAwaitingInput,
    });
    expect(cancelOpenAwaits).not.toHaveBeenCalled();
    expect(clearAwaitingInput).not.toHaveBeenCalled();
  });
});
