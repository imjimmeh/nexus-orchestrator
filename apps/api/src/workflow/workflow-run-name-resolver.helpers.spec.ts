import { describe, expect, it, vi } from 'vitest';
import { resolveWorkflowNameForRun } from './workflow-run-name-resolver.helpers';

describe('resolveWorkflowNameForRun', () => {
  it('resolves run → workflow_id → workflow name', async () => {
    const runRepo = {
      findById: vi.fn().mockResolvedValue({ workflow_id: 'wf-uuid' }),
    };
    const workflowRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'wf-uuid',
        name: 'default_execution_workflow',
      }),
    };

    const name = await resolveWorkflowNameForRun(
      runRepo,
      workflowRepo,
      'run-1',
      vi.fn(),
    );

    expect(name).toBe('default_execution_workflow');
    expect(runRepo.findById).toHaveBeenCalledWith('run-1');
    expect(workflowRepo.findById).toHaveBeenCalledWith('wf-uuid');
  });

  it('returns undefined without querying when workflowRunId is absent', async () => {
    const runRepo = { findById: vi.fn() };
    const name = await resolveWorkflowNameForRun(
      runRepo,
      { findById: vi.fn() },
      undefined,
      vi.fn(),
    );
    expect(name).toBeUndefined();
    expect(runRepo.findById).not.toHaveBeenCalled();
  });

  it('is fail-soft: a repository error reports via onError and returns undefined', async () => {
    const onError = vi.fn();
    const runRepo = {
      findById: vi.fn().mockRejectedValue(new Error('DB down')),
    };

    const name = await resolveWorkflowNameForRun(
      runRepo,
      { findById: vi.fn() },
      'run-1',
      onError,
    );

    expect(name).toBeUndefined();
    expect(onError).toHaveBeenCalledTimes(1);
  });
});
