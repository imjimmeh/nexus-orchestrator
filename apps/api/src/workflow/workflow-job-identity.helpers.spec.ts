import { describe, expect, it } from 'vitest';
import {
  buildAutoRetryQueueJobId,
  buildExecutionMountKey,
  buildRequiredToolRetryQueueJobId,
  buildWorkflowStepQueueJobId,
  sanitizeIdentitySegment,
} from './workflow-job-identity.helpers';

describe('workflow-job-identity helpers', () => {
  it('sanitizes unsafe identity segments', () => {
    expect(
      sanitizeIdentitySegment('required-tool-retry:run:job', 'fallback'),
    ).toBe('required-tool-retry_run_job');
  });

  it('builds mount keys without colons from queue job IDs', () => {
    const mountKey = buildExecutionMountKey({
      workflowRunId: 'd783730e-9f16-46c6-b546-ab809f7b7727',
      jobId: 'pm_refinement',
      bullJobId:
        'required-tool-retry:d783730e-9f16-46c6-b546-ab809f7b7727:pm_refinement',
    });

    expect(mountKey).toContain(
      'required-tool-retry_d783730e-9f16-46c6-b546-ab809f7b7727_pm_refinement',
    );
    expect(mountKey.includes(':')).toBe(false);
  });

  it('builds retry queue IDs without colons', () => {
    const requiredRetry = buildRequiredToolRetryQueueJobId(
      'd783730e-9f16-46c6-b546-ab809f7b7727',
      'pm_refinement',
    );
    const autoRetry = buildAutoRetryQueueJobId(
      'd783730e-9f16-46c6-b546-ab809f7b7727',
      'pm_refinement',
    );

    expect(requiredRetry).toBe(
      'required-tool-retry-d783730e-9f16-46c6-b546-ab809f7b7727-pm_refinement',
    );
    expect(autoRetry).toBe(
      'auto-retry-d783730e-9f16-46c6-b546-ab809f7b7727-pm_refinement',
    );
    expect(requiredRetry.includes(':')).toBe(false);
    expect(autoRetry.includes(':')).toBe(false);
  });

  it('builds standard queue IDs without colons', () => {
    const queueId = buildWorkflowStepQueueJobId(
      'd783730e-9f16-46c6-b546-ab809f7b7727',
      'pm_refinement',
    );

    expect(queueId).toBe(
      'workflow-step-d783730e-9f16-46c6-b546-ab809f7b7727-pm_refinement',
    );
    expect(queueId.includes(':')).toBe(false);
  });

  it('builds standard queue IDs without colons from colon-containing inputs', () => {
    const queueId = buildWorkflowStepQueueJobId(
      'run:with:colon',
      'job:with:colon',
    );

    expect(queueId.includes(':')).toBe(false);
  });
});
