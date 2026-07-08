const NON_RETRYABLE_FAILURE_MARKERS = [
  // Context-specific deterministic failures
  'missing_subtasks',
  'missing_plan',
  'split_pending',
  'war_room_incomplete',
  'requires subtask_blueprint',
  'context exit readiness failed',
  'exit readiness failed',

  // Workflow Definition & Validation (Permanent YAML/Logic issues)
  'invalid workflow yaml',
  'workflow validation failed',
  'workflow definition is invalid',

  // Permissions & Governance (Permanent access/policy issues)
  'permission denied',
  'unauthorized',
  'forbidden',
  'policy denied',
  'not allowed',
  'tool is not available',
  'tool is denied',
  'tool publication status is',
  'current orchestration mode denies',
  'denied by a dynamic approval rule',

  // Contract & Configuration (Permanent setup issues)
  'output_contract.required must be',
  'output contract missing required field(s)',
  'output_contract fields [',
  'max retries (',
  'set_job_output is not callable',
  'validation failed',
  'bad request',
  'invalid argument',
  'missing required parameter',

  // Legacy entity mutation input contract violations (deterministic; retrying will never resolve missing fields)
  'requires updates.subtask_id',
  'invalid status transition',
  'decision is not launchable: conflict_key_active',

  // Git identity (deterministic — environment never self-heals mid-run)
  'author identity unknown',
  'unable to auto-detect email address',

  // Loop guard (deterministic — infinite loop detected)
  'max_loop_iterations',

  // Intentional terminal workflow branches
  'failed at step fail_workflow',

  // Infrastructure / container startup failures (retrying the same step rarely fixes these)
  'container health check timed out',

  // Session integrity (deterministic — a resumed pi session whose leaf is an
  // assistant turn cannot be continued by pi-agent-core; blindly restarting the
  // step discards the already-satisfied output contract and loops. The pi engine
  // recovers by branching past the leaf, but if the error still surfaces it must
  // fail terminally rather than retry.)
  'cannot continue from message role',
] as const;

export function isNonRetryableWorkflowFailure(params: {
  jobId: string;
  reason: string;
}): boolean {
  const normalizedReason = params.reason.toLowerCase();

  return NON_RETRYABLE_FAILURE_MARKERS.some((marker) =>
    normalizedReason.includes(marker),
  );
}
