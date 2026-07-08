import type { DoctorRepairActionId } from './doctor.types';

export const DOCTOR_REPAIR_ACTION_DESCRIPTIONS: Record<
  DoctorRepairActionId,
  string
> = {
  clear_stale_polling_markers:
    'Clear stale in-memory dispatch polling markers that can block cycle requests.',
  requeue_recoverable_workflow_runs:
    'Requeue recoverable pending workflow runs that appear stranded.',
  prune_orphaned_runtime_artifacts:
    'Remove orphaned/stale managed containers and stale runtime mount directories.',
  refresh_mcp_plugin_catalogs:
    'Reload MCP servers and reconcile synchronized tool/plugin catalogs.',
  clean_git_worktrees:
    'Repair and clean up corrupted or locked git worktrees that are blocking workspace operations.',
  recover_api_fetch_failures:
    'Identify and recover workflow runs stuck in API fetch failure loops and restore them to usable state.',
  redispatch_producer_job_with_feedback:
    'Re-dispatch the upstream producer job that generated output rejected by a downstream validation guard, injecting the validation violation as corrective feedback.',
};
