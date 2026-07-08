import { describe, expect, it, vi } from 'vitest';
import { SysadminRepairRequestListener } from './sysadmin-repair-request.listener';
import { REPAIR_DELEGATION_COMPLETED_EVENT } from '../workflow/workflow-repair/repair-delegation.types';

const REPAIR_WORKFLOW_DB_ID = 'repair-workflow-db-id';

function createListener() {
  const workflowRepo = {
    findByIdentifier: vi.fn().mockResolvedValue({
      id: REPAIR_WORKFLOW_DB_ID,
      is_active: true,
    }),
  };
  const workflowEngine = {
    startWorkflow: vi.fn().mockResolvedValue('repair-run-1'),
  };
  const eventEmitter = { emit: vi.fn() };

  const listener = new SysadminRepairRequestListener(
    workflowRepo as never,
    workflowEngine as never,
    eventEmitter,
  );

  return { listener, workflowRepo, workflowEngine, eventEmitter };
}

function requestEvent(overrides: Record<string, unknown> = {}) {
  return {
    workflowRunId: 'original-run-1',
    workflowId: 'original-workflow-1',
    failedJobId: 'failed-job-1',
    policyActionId: 'repair.config.create_local_placeholder',
    attempt: 1,
    decision: { eligibility: 'allow', reason: 'r', evidenceReferences: [] },
    ...overrides,
  };
}

describe('SysadminRepairRequestListener', () => {
  it('starts workflow_environment_repair with the original failure context as trigger', async () => {
    const { listener, workflowEngine } = createListener();

    await listener.handleSysadminRepairRequested(requestEvent() as never);

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      REPAIR_WORKFLOW_DB_ID,
      expect.objectContaining({
        workflowRunId: 'original-run-1',
        workflowId: 'original-workflow-1',
        failedJobId: 'failed-job-1',
        policyActionId: 'repair.config.create_local_placeholder',
        attempt: 1,
      }),
    );
  });

  it('emits a failed completion when the repair workflow cannot be found', async () => {
    const { listener, workflowRepo, workflowEngine, eventEmitter } =
      createListener();
    workflowRepo.findByIdentifier.mockResolvedValue(null);

    await listener.handleSysadminRepairRequested(requestEvent() as never);

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({
        status: 'failed',
        executionPath: 'sysadmin_workflow',
        policyActionId: 'repair.config.create_local_placeholder',
      }),
    );
  });

  it('emits a failed completion when starting the workflow throws', async () => {
    const { listener, workflowEngine, eventEmitter } = createListener();
    workflowEngine.startWorkflow.mockRejectedValue(new Error('engine down'));

    await listener.handleSysadminRepairRequested(requestEvent() as never);

    expect(eventEmitter.emit).toHaveBeenCalledWith(
      REPAIR_DELEGATION_COMPLETED_EVENT,
      expect.objectContaining({ status: 'failed' }),
    );
  });
});
