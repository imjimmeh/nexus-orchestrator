import { describe, expect, it, vi } from 'vitest';
import {
  autoRetryAttemptPath,
  autoRetryEntryPath,
  autoRetryFirstFailureAtPath,
  autoRetryLastFailurePath,
  clearAutoRetryPendingMarker,
  clearAutoRetryState,
} from './workflow-run-retry-state.helpers';

describe('auto-retry path builders', () => {
  it('exposes the entry path as _internal.auto_retry.<jobId>', () => {
    expect(autoRetryEntryPath('alpha')).toBe('_internal.auto_retry.alpha');
  });

  it('builds the per-job attempt state path under the entry namespace', () => {
    expect(autoRetryAttemptPath('alpha')).toBe(
      '_internal.auto_retry.alpha.attempt',
    );
  });

  it('builds the per-job last-failure path under the entry namespace', () => {
    expect(autoRetryLastFailurePath('alpha')).toBe(
      '_internal.auto_retry.alpha.last_failure',
    );
  });

  it('builds the per-job first-failure-at path under the entry namespace', () => {
    expect(autoRetryFirstFailureAtPath('alpha')).toBe(
      '_internal.auto_retry.alpha.first_failure_at',
    );
  });

  it('keeps path builders consistent with the entry namespace', () => {
    const jobId = 'transition_to_ready_to_merge';
    expect(
      autoRetryAttemptPath(jobId).startsWith(autoRetryEntryPath(jobId)),
    ).toBe(true);
    expect(
      autoRetryLastFailurePath(jobId).startsWith(autoRetryEntryPath(jobId)),
    ).toBe(true);
    expect(
      autoRetryFirstFailureAtPath(jobId).startsWith(autoRetryEntryPath(jobId)),
    ).toBe(true);
  });
});

describe('clearAutoRetryPendingMarker', () => {
  it('calls deleteVariable with the last-failure path only', async () => {
    const deleteVariable = vi.fn().mockResolvedValue(undefined);
    const stateManager = { deleteVariable } as never;

    await clearAutoRetryPendingMarker(stateManager, 'run-1', 'alpha');

    expect(deleteVariable).toHaveBeenCalledTimes(1);
    expect(deleteVariable).toHaveBeenCalledWith(
      'run-1',
      autoRetryLastFailurePath('alpha'),
    );
  });
});

describe('clearAutoRetryState', () => {
  it('calls deleteVariable with the entry path so the entire retry entry is wiped', async () => {
    const deleteVariable = vi.fn().mockResolvedValue(undefined);
    const stateManager = { deleteVariable } as never;

    await clearAutoRetryState(stateManager, 'run-1', 'alpha');

    expect(deleteVariable).toHaveBeenCalledTimes(1);
    expect(deleteVariable).toHaveBeenCalledWith(
      'run-1',
      autoRetryEntryPath('alpha'),
    );
  });

  it('does not delete individual sub-keys (entry-level wipe only)', async () => {
    const deleteVariable = vi.fn().mockResolvedValue(undefined);
    const stateManager = { deleteVariable } as never;

    await clearAutoRetryState(
      stateManager,
      'run-1',
      'transition_to_ready_to_merge',
    );

    const calledPaths = deleteVariable.mock.calls.map(([, path]) => path);
    expect(calledPaths).not.toContain(
      autoRetryAttemptPath('transition_to_ready_to_merge'),
    );
    expect(calledPaths).not.toContain(
      autoRetryLastFailurePath('transition_to_ready_to_merge'),
    );
    expect(calledPaths).not.toContain(
      autoRetryFirstFailureAtPath('transition_to_ready_to_merge'),
    );
  });
});
