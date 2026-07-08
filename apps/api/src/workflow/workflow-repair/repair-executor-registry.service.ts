import { Injectable } from '@nestjs/common';
import type { DoctorRepairActionId } from '../../operations/doctor.types';
import type { RepairExecutionPlan } from './repair-delegation.types';

const DOCTOR_PLAN_BY_POLICY_ACTION: Record<string, DoctorRepairActionId> = {
  'doctor.runtime_artifact.refresh_stale_artifacts':
    'prune_orphaned_runtime_artifacts',
  'doctor.polling.clear_stale_markers': 'clear_stale_polling_markers',
  'doctor.workflow_run.requeue_recoverable':
    'requeue_recoverable_workflow_runs',
  'doctor.mcp.refresh_plugin_catalogs': 'refresh_mcp_plugin_catalogs',
  'doctor.git.clean_worktrees': 'clean_git_worktrees',
  'doctor.api.recover_fetch_failures': 'recover_api_fetch_failures',
  'doctor.workflow_run.redispatch_producer_with_feedback':
    'redispatch_producer_job_with_feedback',
};

const SYSADMIN_POLICY_ACTIONS = new Set<string>([
  'repair.dependency.add_declared_package',
  'repair.config.create_local_placeholder',
]);

@Injectable()
export class RepairExecutorRegistryService {
  resolveExecutionPlan(policyActionId: string): RepairExecutionPlan | null {
    const concreteActionId = DOCTOR_PLAN_BY_POLICY_ACTION[policyActionId];
    if (concreteActionId) {
      return { path: 'doctor', policyActionId, concreteActionId };
    }

    if (SYSADMIN_POLICY_ACTIONS.has(policyActionId)) {
      return { path: 'sysadmin_workflow', policyActionId };
    }

    return null;
  }
}
