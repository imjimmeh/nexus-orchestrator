import type { WorkflowStatus } from '@nexus/core';
import type { CoreWorkflowEventEnvelopeV1Shape } from '@nexus/core';

// ── Run-level event payload ────────────────────────────────────────────────────

/**
 * Payload carried by every `workflow.run.*` event.
 *
 * Includes all context a listener needs to react without re-querying
 * the database: the run identity, current status, and full state.
 */
export interface WorkflowRunEvent {
  workflowRunId: string;
  workflowId: string;
  status: WorkflowStatus;
  stateVariables: Record<string, unknown>;
  /** Original trigger data that started the run (from state_variables.trigger). */
  triggerData?: Record<string, unknown>;
  /** Human-readable reason for terminal transitions (failed / cancelled). */
  reason?: string;
  /** Job that caused a workflow failure, when available. */
  failedJobId?: string;
  /** Error text suitable for event-ledger failure diagnostics. */
  errorMessage?: string;
}

// ── Job-level event payload ────────────────────────────────────────────────────

/**
 * Payload carried by every `workflow.job.*` event.
 */
export interface WorkflowJobEvent {
  workflowRunId: string;
  workflowId?: string;
  jobId: string;
  /** Structured output produced by the job (available on `job.completed`). */
  output?: Record<string, unknown>;
  /** Failure reason (available on `job.failed`). */
  reason?: string;
  /** Arbitrary audit metadata (e.g. queued-job configuration snapshot). */
  payload?: Record<string, unknown>;
}

// ── Core lifecycle stream event payload ───────────────────────────────────────

/**
 * Payload for the internal `workflow.core.lifecycle` bus event.
 *
 * Carries a fully-built CoreWorkflowRunEventEnvelopeV1 so that
 * stream listeners can publish it without rebuilding the envelope.
 */
export interface WorkflowCoreLifecycleEvent {
  runId: string;
  workflowId: string;
  envelope: CoreWorkflowEventEnvelopeV1Shape;
}
