import { describe, expect, it, vi } from 'vitest';
import { WorkflowFailureDoctorTriggerListener } from './workflow-failure-doctor-trigger.listener';

const DOCTOR_WORKFLOW_DB_ID = 'doctor-workflow-db-id';
const REPAIR_WORKFLOW_DB_ID = 'repair-workflow-db-id';

function createListener() {
  const workflowRepo = {
    findByIdentifier: vi.fn(),
  };
  const workflowEngine = {
    startWorkflow: vi.fn().mockResolvedValue('doctor-run-1'),
  };

  const listener = new WorkflowFailureDoctorTriggerListener(
    workflowRepo as never,
    workflowEngine as never,
  );

  return { listener, workflowRepo, workflowEngine };
}

function failedEvent(overrides: Record<string, unknown> = {}) {
  return {
    workflowRunId: 'failed-run-1',
    workflowId: 'business-workflow-id',
    status: 'failed',
    reason: 'boom',
    stateVariables: { trigger: { scopeId: 'scope-1' } },
    ...overrides,
  };
}

describe('WorkflowFailureDoctorTriggerListener', () => {
  it('starts the doctor workflow on an unrelated workflow failure', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: DOCTOR_WORKFLOW_DB_ID,
      is_active: true,
    });

    await listener.handleWorkflowRunFailed(failedEvent());

    expect(workflowEngine.startWorkflow).toHaveBeenCalledWith(
      DOCTOR_WORKFLOW_DB_ID,
      expect.objectContaining({
        event: 'workflow.failure_doctor',
        source: 'workflow_failure_doctor_trigger',
        scopeId: 'scope-1',
        failed_workflow_run_id: 'failed-run-1',
        failed_workflow_id: 'business-workflow-id',
        failure_reason: 'boom',
      }),
    );
  });

  it('does not trigger when the failed workflow IS the doctor workflow (no self-loop)', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: DOCTOR_WORKFLOW_DB_ID,
      is_active: true,
    });

    await listener.handleWorkflowRunFailed(
      failedEvent({ workflowId: DOCTOR_WORKFLOW_DB_ID }),
    );

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });

  it('does not trigger for the environment repair workflow', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier
      .mockResolvedValueOnce({ id: DOCTOR_WORKFLOW_DB_ID, is_active: true })
      .mockResolvedValueOnce({ id: REPAIR_WORKFLOW_DB_ID, is_active: true });

    await listener.handleWorkflowRunFailed(
      failedEvent({ workflowId: REPAIR_WORKFLOW_DB_ID }),
    );

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });

  it('does not trigger the same failed run twice', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue({
      id: DOCTOR_WORKFLOW_DB_ID,
      is_active: true,
    });

    await listener.handleWorkflowRunFailed(failedEvent());
    await listener.handleWorkflowRunFailed(failedEvent());

    expect(workflowEngine.startWorkflow).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the doctor workflow is missing or inactive', async () => {
    const { listener, workflowRepo, workflowEngine } = createListener();
    workflowRepo.findByIdentifier.mockResolvedValue(null);

    await listener.handleWorkflowRunFailed(failedEvent());

    expect(workflowEngine.startWorkflow).not.toHaveBeenCalled();
  });
});
