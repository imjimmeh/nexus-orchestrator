import type { RepairPolicyConfig } from './repair-policy.config.types';

export const REPAIR_POLICY_CONFIG = {
  dependency_missing: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: ['repair.dependency.add_declared_package'],
    humanRequired: false,
    defaultExecutor: 'sysadmin_workflow',
    diagnosticLabel: 'Dependency missing',
  },
  config_missing_local: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: ['repair.config.create_local_placeholder'],
    humanRequired: false,
    defaultExecutor: 'sysadmin_workflow',
    diagnosticLabel: 'Local config missing',
  },
  runtime_artifact_stale: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [
      'doctor.runtime_artifact.refresh_stale_artifacts',
      'doctor.polling.clear_stale_markers',
      'doctor.workflow_run.requeue_recoverable',
      'doctor.git.clean_worktrees',
    ],
    humanRequired: false,
    defaultExecutor: 'doctor',
    diagnosticLabel: 'Runtime artifact stale',
  },
  runtime_stall_recoverable: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: ['doctor.workflow_run.requeue_recoverable'],
    humanRequired: false,
    defaultExecutor: 'doctor',
    diagnosticLabel: 'Runtime stall (recoverable)',
  },
  provider_transient: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: ['doctor.workflow_run.requeue_recoverable'],
    humanRequired: false,
    defaultExecutor: 'doctor',
    diagnosticLabel: 'Transient provider/transport fault (recoverable)',
  },
  context_window_exceeded: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [],
    humanRequired: true,
    diagnosticLabel: 'Context window exceeded',
  },
  tool_contract_mismatch: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [],
    humanRequired: true,
    diagnosticLabel: 'Tool contract mismatch',
  },
  credential_missing: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [],
    humanRequired: false,
    diagnosticLabel: 'Credential missing',
  },
  quality_gate_failed: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [],
    humanRequired: true,
    diagnosticLabel: 'Pre-push quality gate failed',
  },
  merge_dirty_worktree: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [],
    humanRequired: true,
    diagnosticLabel: 'Merge blocked by dirty worktree',
  },
  split_coverage_invalid: {
    minimumConfidence: 0.8,
    allowedRepairActionIds: [
      'doctor.workflow_run.redispatch_producer_with_feedback',
    ],
    humanRequired: false,
    defaultExecutor: 'doctor',
    diagnosticLabel: 'Split coverage validation failed (recoverable)',
  },
  ambiguous_failure: {
    minimumConfidence: 0.7,
    allowedRepairActionIds: [],
    humanRequired: true,
    diagnosticLabel: 'Ambiguous failure',
  },
} as const satisfies RepairPolicyConfig;
