import { describe, expect, it, vi } from 'vitest';
import { WorkflowDelegationToolProjectionService } from './workflow-delegation-tool-projection.service';
import { WorkflowDelegationToolsController } from './workflow-delegation-tools.controller';

describe('WorkflowDelegationToolsController', () => {
  it('passes tool name, request body, and agent workflow run context to the projection service', async () => {
    const projections = {
      invokeProjectedDelegation: vi
        .fn()
        .mockResolvedValue({ ok: true, runId: 'child-run' }),
    };
    const controller = new WorkflowDelegationToolsController(
      projections as unknown as WorkflowDelegationToolProjectionService,
    );

    const result = await controller.invokeProjectedDelegation(
      'delegate_goal_backlog_planning',
      {
        user: { userId: 'agent:run-parent:job-1', stepId: 'decide' },
      },
      { reason: 'Need backlog' },
    );

    expect(projections.invokeProjectedDelegation).toHaveBeenCalledWith(
      'delegate_goal_backlog_planning',
      { reason: 'Need backlog' },
      'run-parent',
      'decide',
    );
    expect(result).toEqual({
      success: true,
      data: { ok: true, runId: 'child-run' },
    });
  });
});
