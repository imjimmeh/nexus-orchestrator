export type ExecutionKind =
  | 'workflow_step'
  | 'workflow_chat'
  | 'adhoc_chat'
  | 'subagent';

export type ExecutionState =
  | 'pending'
  | 'provisioning'
  | 'running'
  | 'awaiting_input'
  | 'completing'
  | 'completed'
  | 'failed'
  | 'reaped'
  | 'cancelled'
  | 'retry_scheduled';

export type ExecutionFailureReason =
  | 'provision_failed'
  | 'spawn_timeout'
  | 'never_dispatched'
  | 'idle_timeout'
  | 'max_runtime_exceeded'
  | 'container_lost'
  | 'agent_error'
  | 'step_failed'
  | 'cancelled_by_user'
  | 'parent_terminated'
  | 'superseded';

export type ExecutionEventType =
  | 'execution.created'
  | 'execution.provisioning'
  | 'execution.provisioned'
  | 'execution.provision_failed'
  | 'execution.running'
  | 'execution.heartbeat'
  | 'execution.awaiting_input'
  | 'execution.input_received'
  | 'execution.completion_signaled'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.reaped'
  | 'execution.cancelled'
  | 'execution.retry_scheduled'
  | 'execution.paused'
  | 'execution.resumed'
  | 'execution.dispatch.ip_resolved'
  | 'execution.dispatch.ip_resolution_failed';
