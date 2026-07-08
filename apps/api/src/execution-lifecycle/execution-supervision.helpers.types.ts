import type {
  ExecutionFailureReason,
  ExecutionKind,
  ExecutionState,
} from './execution-lifecycle.contracts';

/**
 * Discriminated union returned by {@link classifyExecutionForReaping}.
 * - `reap`: the execution should be terminated with the given failure reason.
 * - `reconcile_completed`: the agent finished successfully; emit `execution.completed`.
 * - `reconcile_failed`: the agent finished in failure; emit `execution.failed`
 *   (so on_failure / conditional branches are honored rather than silently
 *   swallowing the failure as a success).
 */
export type ReapDecision =
  | { kind: 'reap'; reason: ExecutionFailureReason }
  | { kind: 'reconcile_completed' }
  | { kind: 'reconcile_failed' };

export interface SupervisionInput {
  kind?: ExecutionKind;
  state: ExecutionState;
  createdAtMs: number;
  lastHeartbeatAtMs: number;
  containerLost: boolean;
  /**
   * How long (ms) the container has been *continuously* observed lost across
   * consecutive sweeps, or null when it is not currently lost or this is the
   * first sweep that observed it lost. Used to debounce the container_lost reap
   * across all container-backed kinds so normal container cleanup (which briefly
   * leaves a dead container_id on a still-running row) is not mistaken for an orphan.
   */
  containerLostForMs?: number | null;
  /**
   * True when at least one non-terminal subagent execution exists for the same
   * workflow run as this `workflow_step` execution. When set, `container_lost`
   * is suppressed — the step's container is intentionally absent while a child
   * subagent is running on its behalf (fire-and-poll pattern). The
   * `max_runtime_exceeded` ceiling still applies as a hard safety net.
   */
  hasLiveChildSubagent?: boolean;
  /**
   * How long (ms) ago the agent's loop ended according to the event ledger
   * (`workflow.agent.completed`), or null when no such signal exists. When this
   * value is ≥ `RECONCILE_GRACE_MS` and the container is still alive, the
   * supervisor reconciles the step instead of waiting for the max-runtime
   * ceiling. Only meaningful for `workflow_step` executions.
   */
  agentEndedForMs?: number | null;
  /**
   * The outcome carried by the agent-end ledger signal that produced
   * {@link agentEndedForMs}. `'failure'` reconciles the step as failed
   * (`execution.failed`) so on_failure / conditional branches run; anything
   * else (including undefined) reconciles as completed. Only consulted when
   * the reconcile conditions hold.
   */
  agentEndedOutcome?: 'success' | 'failure';
  /**
   * True when the job has durably persisted its terminal output (a
   * `workflow.agent.output_persisted` ledger signal exists). This is the
   * crash-safe fallback used when the `workflow.agent.completed` telemetry
   * event was lost — e.g. an API restart between the output write and the
   * agent-end emit. Only meaningful for `workflow_step` executions and only
   * consulted when {@link agentEndedForMs} is absent.
   */
  durableOutputPersisted?: boolean;
  /**
   * How long (ms) the job has been quiescent — i.e. now minus the most recent
   * ledger activity for the job. When this is ≥ `DURABLE_OUTPUT_QUIESCENCE_MS`
   * and {@link durableOutputPersisted} is true, the step is reconciled as
   * completed. The quiescence window prevents prematurely completing an agent
   * that set output mid-loop and is still working.
   */
  durableOutputQuiescentForMs?: number | null;
  /**
   * How long (ms) the durable owner lease has been expired, or null when the
   * owner lease is absent or still active. Only meaningful for running
   * `workflow_step` executions.
   */
  ownerLeaseExpiredForMs?: number | null;
  /**
   * How long (ms) since the most recent durable activity for the job. Used with
   * owner lease expiry so healthy long-running steps are not reaped while still
   * producing progress signals.
   */
  latestJobActivityQuiescentForMs?: number | null;
}
