/**
 * Canonical event name constants for the workflow lifecycle.
 *
 * These replace the legacy `WORKFLOW_RUN_STATUS_CHANGED_EVENT` pattern
 * and allow independent listeners to react to specific state transitions
 * without coupling to a shared "status" field.
 *
 * @see workflow-events.types.ts for payload interfaces
 * @see docs/architecture/workflow-engine.md
 */

// ── Run-level lifecycle ────────────────────────────────────────────────────────

export const WORKFLOW_RUN_STARTED_EVENT = 'workflow.run.started';
export const WORKFLOW_RUN_COMPLETED_EVENT = 'workflow.run.completed';
export const WORKFLOW_RUN_FAILED_EVENT = 'workflow.run.failed';
export const WORKFLOW_RUN_CANCELLED_EVENT = 'workflow.run.cancelled';
export const WORKFLOW_RUN_PAUSED_EVENT = 'workflow.run.paused';
export const WORKFLOW_RUN_RESUMED_EVENT = 'workflow.run.resumed';

// ── Job-level lifecycle ────────────────────────────────────────────────────────

export const WORKFLOW_JOB_QUEUED_EVENT = 'workflow.job.queued';
export const WORKFLOW_JOB_STARTED_EVENT = 'workflow.job.started';
export const WORKFLOW_JOB_COMPLETED_EVENT = 'workflow.job.completed';
export const WORKFLOW_JOB_FAILED_EVENT = 'workflow.job.failed';
export const WORKFLOW_RUN_RETRY_SCHEDULED_EVENT =
  'workflow.run.retry-scheduled';
export const WORKFLOW_RUN_ACTIVATED_FROM_QUEUE_EVENT =
  'workflow.run.activated-from-queue';

// ── Internal bus event for durable core-service lifecycle publication ─────────

/**
 * Emitted by WorkflowInternalCoreRunsService whenever it builds a
 * CoreWorkflowRunEventEnvelopeV1 that must be written to the durable
 * core lifecycle stream.
 */
export const WORKFLOW_CORE_LIFECYCLE_EVENT = 'workflow.core.lifecycle';
