import { describe, expect, it, vi } from 'vitest';
import { workflowTest } from './workflow-test-harness';

describe('WorkflowTestHarness', () => {
  it('builds dry-run requests with trigger, state, and mocked jobs', async () => {
    const startWorkflow = vi.fn().mockResolvedValue({
      dryRun: true,
      workflowId: 'resource_in_progress_default',
      workflowName: 'Resource Fixture',
      executionPath: ['provision_worktree', 'implement_and_commit'],
      parallelGroups: [['provision_worktree'], ['implement_and_commit']],
      stateTransitions: ['verified'],
      mockJobsApplied: ['implement_and_commit'],
    });

    const result = await workflowTest(
      { startWorkflow },
      'resource_in_progress_default',
    )
      .withTrigger({ contextId: 'wi-1' })
      .withState({ previousDecision: 'dispatch' })
      .mockJob('implement_and_commit', { ok: true })
      .run();

    expect(startWorkflow).toHaveBeenCalledWith(
      'resource_in_progress_default',
      {
        contextId: 'wi-1',
        __dryRunInitialState: { previousDecision: 'dispatch' },
      },
      {
        dryRun: true,
        mockJobOutputs: {
          implement_and_commit: { ok: true },
        },
      },
    );
    expect(result.stateTransitions).toContain('verified');
    expect(result.initialState).toEqual({ previousDecision: 'dispatch' });
  });
});
