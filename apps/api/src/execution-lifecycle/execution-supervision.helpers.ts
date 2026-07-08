export type {
  ReapDecision,
  SupervisionInput,
} from './execution-supervision.helpers.types';
import type {
  ReapDecision,
  SupervisionInput,
} from './execution-supervision.helpers.types';

export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60_000; // 15 min with no heartbeat
export const DEFAULT_MAX_RUNTIME_MS = 4 * 60 * 60_000; // 4h hard ceiling
// Grace window between the agent.completed ledger event and the supervisor
// reconciling the step as completed. Allows the normal in-process completion
// awaiter (StepExecutionCompletionListener) to win the race first without
// interference from the supervisor safety-net.
export const RECONCILE_GRACE_MS = 60_000; // 1 minute
// Wall-clock silence required before the supervisor reconciles a step from its
// durable output signal (the crash-safe fallback when `workflow.agent.completed`
// telemetry was lost). Longer than RECONCILE_GRACE_MS because the durable signal
// is weaker than an explicit agent-end: an agent may call set_job_output mid-loop
// and keep working, so we wait for genuine quiescence (no ledger activity for the
// job) before treating the persisted output as terminal.
export const DURABLE_OUTPUT_QUIESCENCE_MS = 3 * 60_000; // 3 minutes
// Owner leases survive API restarts. A workflow step is considered orphaned
// only after both the lease and the job ledger have been quiet for this window.
export const WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS = 3 * 60_000; // 3 minutes
// Debounce window for container_lost across all execution kinds. Must exceed one
// supervisor sweep interval so a single transient observation (normal container
// cleanup racing the execution.completed projection) never triggers a reap,
// while a genuine orphan (process restart) still gets reaped shortly after.
export const DEFAULT_CONTAINER_LOST_GRACE_MS = 90_000; // 90s (~3 sweeps)
// Maximum time a provisioning execution may remain in the provisioning state
// before being reaped as a spawn_timeout (container never came up).
export const DEFAULT_PROVISION_GRACE_MS = 5 * 60_000; // 5 min

function resolvePositiveIntMs(
  raw: string | undefined,
  fallback: number,
): number {
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return parsed;
}

export function resolveIdleTimeoutMs(raw: string | undefined): number {
  return resolvePositiveIntMs(raw, DEFAULT_IDLE_TIMEOUT_MS);
}

export function resolveMaxRuntimeMs(raw: string | undefined): number {
  return resolvePositiveIntMs(raw, DEFAULT_MAX_RUNTIME_MS);
}

export function resolveContainerLostGraceMs(raw: string | undefined): number {
  return resolvePositiveIntMs(raw, DEFAULT_CONTAINER_LOST_GRACE_MS);
}

export function resolveProvisionGraceMs(raw: string | undefined): number {
  return resolvePositiveIntMs(raw, DEFAULT_PROVISION_GRACE_MS);
}

/**
 * Returns true when a container has been continuously observed lost long enough
 * to be reaped as a genuine orphan. Returns false when the grace window has not
 * elapsed, when the loss is still transient (first observation), or when the
 * execution is a fire-and-poll `workflow_step` parent whose container exited
 * intentionally while a child subagent runs on its behalf — in that case the
 * parent must NOT be reaped for container loss (max_runtime_exceeded still
 * applies as a hard ceiling regardless).
 */
function shouldReapForContainerLost(
  input: SupervisionInput,
  containerLostGraceMs: number,
): boolean {
  if (!input.containerLost) return false;
  const lostForMs = input.containerLostForMs ?? null;
  if (lostForMs === null || lostForMs < containerLostGraceMs) return false;
  // Fire-and-poll parent: container exits while child subagent continues work.
  if (input.kind === 'workflow_step' && input.hasLiveChildSubagent === true) {
    return false;
  }
  return true;
}

/**
 * Returns the appropriate early-state reap reason for provisioning/pending
 * executions that have stalled beyond the provision grace window, or null
 * when the execution is in a different state or within the window.
 */
function classifyStaleProvisionState(
  input: SupervisionInput,
  nowMs: number,
  provisionGraceMs: number,
): ReapDecision | null {
  if (
    input.state === 'provisioning' &&
    nowMs - input.createdAtMs > provisionGraceMs
  ) {
    return { kind: 'reap', reason: 'spawn_timeout' };
  }
  if (
    input.state === 'pending' &&
    nowMs - input.createdAtMs > provisionGraceMs
  ) {
    return { kind: 'reap', reason: 'never_dispatched' };
  }
  return null;
}

/**
 * Classifies a `workflow_step` execution that has survived the earlier hard
 * checks (container_lost, max_runtime). When the agent loop has finished and
 * the grace window has elapsed, returns `reconcile_failed` if the agent-end
 * signal carried a failure outcome (so on_failure / conditional branches run)
 * or `reconcile_completed` otherwise; returns null to leave the step running.
 *
 * workflow_step executions manage their own lifecycle via
 * StepExecutionCompletionListener and never emit heartbeats through the
 * telemetry gateway — so last_heartbeat_at falls back to created_at and
 * would incorrectly trip idle_timeout after 15 min. This function provides
 * a positive reconciliation path before the 4h max-runtime ceiling destroys
 * the step.
 */
function classifyWorkflowStep(input: SupervisionInput): ReapDecision | null {
  if (
    input.state !== 'running' ||
    input.containerLost ||
    input.hasLiveChildSubagent === true
  ) {
    return null;
  }
  // Primary path: explicit agent-end telemetry signal.
  if (
    input.agentEndedForMs != null &&
    input.agentEndedForMs >= RECONCILE_GRACE_MS
  ) {
    return input.agentEndedOutcome === 'failure'
      ? { kind: 'reconcile_failed' }
      : { kind: 'reconcile_completed' };
  }
  // Crash-safe fallback: the telemetry signal was lost (e.g. API restart between
  // the durable output write and the agent-end emit), but the job durably
  // persisted its terminal output and has since gone quiescent.
  if (
    input.durableOutputPersisted === true &&
    input.durableOutputQuiescentForMs != null &&
    input.durableOutputQuiescentForMs >= DURABLE_OUTPUT_QUIESCENCE_MS
  ) {
    return { kind: 'reconcile_completed' };
  }
  if (shouldReapForExpiredOwnerLease(input)) {
    return { kind: 'reap', reason: 'idle_timeout' };
  }
  return null;
}

function shouldReapForExpiredOwnerLease(input: SupervisionInput): boolean {
  if (input.kind !== 'workflow_step') return false;
  if (input.state !== 'running') return false;
  if (input.containerLost) return false;
  if (input.hasLiveChildSubagent === true) return false;
  if (input.agentEndedForMs != null) return false;
  if (input.durableOutputPersisted === true) return false;
  if (
    (input.ownerLeaseExpiredForMs ?? 0) < WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS
  ) {
    return false;
  }
  return (
    (input.latestJobActivityQuiescentForMs ?? 0) >=
    WORKFLOW_STEP_OWNER_ORPHAN_GRACE_MS
  );
}

export function classifyExecutionForReaping(
  input: SupervisionInput,
  nowMs: number,
  idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  maxRuntimeMs: number = DEFAULT_MAX_RUNTIME_MS,
  containerLostGraceMs: number = DEFAULT_CONTAINER_LOST_GRACE_MS,
  provisionGraceMs: number = DEFAULT_PROVISION_GRACE_MS,
): ReapDecision | null {
  if (shouldReapForContainerLost(input, containerLostGraceMs)) {
    return { kind: 'reap', reason: 'container_lost' };
  }
  if (nowMs - input.createdAtMs > maxRuntimeMs) {
    return { kind: 'reap', reason: 'max_runtime_exceeded' };
  }
  const provisionDecision = classifyStaleProvisionState(
    input,
    nowMs,
    provisionGraceMs,
  );
  if (provisionDecision) {
    return provisionDecision;
  }
  if (input.state === 'awaiting_input') {
    return null;
  }
  if (input.kind === 'workflow_step') {
    return classifyWorkflowStep(input);
  }
  if (nowMs - input.lastHeartbeatAtMs > idleTimeoutMs) {
    return { kind: 'reap', reason: 'idle_timeout' };
  }
  return null;
}
