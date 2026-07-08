import { describe, expect, it } from 'vitest';
import {
  computeFailedJobKey,
  extractQueueJobContext,
  resolveRunJobId,
} from './queue-job-context.helpers';

describe('extractQueueJobContext', () => {
  it('returns the workflow run id and optional job id from a payload', () => {
    expect(
      extractQueueJobContext({
        workflowRunId: 'run-1',
        jobId: 'job-1',
      }),
    ).toEqual({ workflowRunId: 'run-1', jobId: 'job-1' });
  });

  it('omits jobId when not a string', () => {
    expect(
      extractQueueJobContext({
        workflowRunId: 'run-1',
        jobId: 42,
      }),
    ).toEqual({ workflowRunId: 'run-1', jobId: undefined });
  });

  it('returns null when payload is not an object', () => {
    expect(extractQueueJobContext(null)).toBeNull();
    expect(extractQueueJobContext('run-1')).toBeNull();
    expect(extractQueueJobContext(undefined)).toBeNull();
  });

  it('returns null when workflowRunId is missing or not a string', () => {
    expect(extractQueueJobContext({})).toBeNull();
    expect(extractQueueJobContext({ workflowRunId: 7 })).toBeNull();
  });
});

describe('resolveRunJobId', () => {
  it('returns the current step id when defined and non-empty', () => {
    expect(resolveRunJobId('job-1')).toBe('job-1');
  });

  it('returns the fallback when current step id is undefined or empty', () => {
    expect(resolveRunJobId(undefined)).toBe('unknown_job');
    expect(resolveRunJobId('')).toBe('unknown_job');
  });
});

describe('computeFailedJobKey', () => {
  it('prefers the BullMQ job id when available', () => {
    expect(
      computeFailedJobKey({ id: 'bull-1' }, 'run-1', 'job-1', 'reason'),
    ).toBe('bull-1');
  });

  it('builds a composite key when the job id is missing', () => {
    expect(computeFailedJobKey({}, 'run-1', 'job-1', 'reason')).toBe(
      'run-1:job-1:reason',
    );
  });
});
