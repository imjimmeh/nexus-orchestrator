import { describe, expect, it } from 'vitest';
import { RepairExecutorRegistryService } from './repair-executor-registry.service';

describe('RepairExecutorRegistryService', () => {
  const service = new RepairExecutorRegistryService();

  it('maps runtime artifact policy repair to the concrete doctor repair action', () => {
    expect(
      service.resolveExecutionPlan(
        'doctor.runtime_artifact.refresh_stale_artifacts',
      ),
    ).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
      concreteActionId: 'prune_orphaned_runtime_artifacts',
    });
  });

  it.each([
    'repair.dependency.add_declared_package',
    'repair.config.create_local_placeholder',
  ] as const)('maps %s to the sysadmin workflow path', (policyActionId) => {
    expect(service.resolveExecutionPlan(policyActionId)).toEqual({
      path: 'sysadmin_workflow',
      policyActionId,
    });
  });

  it('maps stale runtime artifact refresh to the doctor prune action', () => {
    const plan = service.resolveExecutionPlan(
      'doctor.runtime_artifact.refresh_stale_artifacts',
    );
    expect(plan).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.runtime_artifact.refresh_stale_artifacts',
      concreteActionId: 'prune_orphaned_runtime_artifacts',
    });
  });

  it('maps stale polling markers to the doctor clear action', () => {
    const plan = service.resolveExecutionPlan(
      'doctor.polling.clear_stale_markers',
    );
    expect(plan).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.polling.clear_stale_markers',
      concreteActionId: 'clear_stale_polling_markers',
    });
  });

  it('maps recoverable run requeue to the doctor requeue action', () => {
    const plan = service.resolveExecutionPlan(
      'doctor.workflow_run.requeue_recoverable',
    );
    expect(plan).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.workflow_run.requeue_recoverable',
      concreteActionId: 'requeue_recoverable_workflow_runs',
    });
  });

  it('maps api fetch recovery to the doctor recover action', () => {
    const plan = service.resolveExecutionPlan(
      'doctor.api.recover_fetch_failures',
    );
    expect(plan).toEqual({
      path: 'doctor',
      policyActionId: 'doctor.api.recover_fetch_failures',
      concreteActionId: 'recover_api_fetch_failures',
    });
  });

  it('returns null for unknown action ids', () => {
    expect(service.resolveExecutionPlan('unknown.action')).toBeNull();
  });
});
