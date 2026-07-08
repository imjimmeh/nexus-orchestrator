export const EXECUTION_KINDS = [
  'workflow_step',
  'workflow_chat',
  'adhoc_chat',
  'subagent',
] as const;

export const EXECUTION_STATES = [
  'pending',
  'provisioning',
  'running',
  'awaiting_input',
  'completing',
  'completed',
  'failed',
  'reaped',
  'cancelled',
  'retry_scheduled',
] as const;

export const EXECUTION_FAILURE_REASONS = [
  'provision_failed',
  'spawn_timeout',
  'never_dispatched',
  'idle_timeout',
  'max_runtime_exceeded',
  'container_lost',
  'agent_error',
  'step_failed',
  'cancelled_by_user',
  'parent_terminated',
  'superseded',
] as const;

export const EXECUTION_AGGREGATE_TYPE = 'execution';

export const EXECUTION_EVENT_TYPES = {
  created: 'execution.created',
  provisioning: 'execution.provisioning',
  provisioned: 'execution.provisioned',
  provisionFailed: 'execution.provision_failed',
  running: 'execution.running',
  heartbeat: 'execution.heartbeat',
  awaitingInput: 'execution.awaiting_input',
  inputReceived: 'execution.input_received',
  completionSignaled: 'execution.completion_signaled',
  completed: 'execution.completed',
  failed: 'execution.failed',
  reaped: 'execution.reaped',
  cancelled: 'execution.cancelled',
  retryScheduled: 'execution.retry_scheduled',
  paused: 'execution.paused',
  resumed: 'execution.resumed',
  ipResolved: 'execution.dispatch.ip_resolved',
  ipResolutionFailed: 'execution.dispatch.ip_resolution_failed',
} as const;

export type {
  ExecutionKind,
  ExecutionState,
  ExecutionFailureReason,
  ExecutionEventType,
} from './execution-lifecycle.contracts.types';
