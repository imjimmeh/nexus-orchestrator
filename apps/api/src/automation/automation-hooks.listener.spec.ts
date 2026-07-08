import { describe, expect, it, vi } from 'vitest';
import { WorkflowStatus } from '@nexus/core';
import { AutomationHooksListener } from './automation-hooks.listener';

describe('AutomationHooksListener', () => {
  it('dispatches failed-run hooks with failure context for diagnostics workflows', async () => {
    const dispatchHooks = vi.fn().mockResolvedValue(undefined);
    const listener = new AutomationHooksListener({
      dispatchHooks,
    } as never);

    await listener.onWorkflowRunFailed({
      workflowRunId: 'run-1',
      workflowId: 'resource_in_progress_default',
      status: WorkflowStatus.FAILED,
      reason: 'duplicate key value violates unique constraint',
      triggerData: {
        scope_id: 'project-1',
        contextId: 'resource-1',
      },
      stateVariables: {
        trigger: {
          scopeId: 'project-1',
          contextId: 'resource-1',
        },
      },
    });

    expect(dispatchHooks).toHaveBeenCalledWith({
      triggerType: 'workflow.run.failed',
      scopeId: 'project-1',
      payload: {
        workflow_run_id: 'run-1',
        workflow_id: 'resource_in_progress_default',
        status: WorkflowStatus.FAILED,
        failure_reason: 'duplicate key value violates unique constraint',
        trigger_data: {
          scope_id: 'project-1',
          contextId: 'resource-1',
        },
        state_variables: {
          trigger: {
            scopeId: 'project-1',
            contextId: 'resource-1',
          },
        },
      },
    });
  });

  it('skips failed-run hook dispatch when project id is unavailable', async () => {
    const dispatchHooks = vi.fn().mockResolvedValue(undefined);
    const listener = new AutomationHooksListener({
      dispatchHooks,
    } as never);

    await listener.onWorkflowRunFailed({
      workflowRunId: 'run-1',
      workflowId: 'resource_in_progress_default',
      status: WorkflowStatus.FAILED,
      reason: 'validation failed',
      stateVariables: {
        trigger: {
          contextId: 'resource-1',
        },
      },
    });

    expect(dispatchHooks).not.toHaveBeenCalled();
  });
});
