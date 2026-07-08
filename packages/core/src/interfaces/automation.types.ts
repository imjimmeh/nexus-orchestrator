export enum AutomationHookTriggerType {
  WORKFLOW_RUN_STARTED = "workflow.run.started",
  WORKFLOW_RUN_FAILED = "workflow.run.failed",
  RESOURCE_STATUS_CHANGED = "resource.status.changed",
  ORCHESTRATION_COMPLETED = "orchestration.completed",
}

export enum AutomationHookActionType {
  INVOKE_WORKFLOW = "invoke_workflow",
  EMIT_EVENT = "emit_event",
  RECORD_METADATA = "record_metadata",
}

export interface IAutomationHook {
  id: string;
  scopeId: string;
  enabled: boolean;
  trigger_type: AutomationHookTriggerType;
  trigger_filter?: Record<string, unknown> | null;
  priority: number;
  action_type: AutomationHookActionType;
  action_payload: Record<string, unknown>;
  cooldown_window_seconds: number;
  last_fired_at?: Date | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface IHeartbeatProfile {
  id: string;
  scopeId: string;
  name: string;
  enabled: boolean;
  interval_seconds: number;
  workflow_id: string;
  payload_json: Record<string, unknown>;
  next_run_at?: Date | null;
  last_run_at?: Date | null;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: Date;
  updated_at: Date;
}

export enum HeartbeatRunStatus {
  TRIGGERED = "triggered",
  RUNNING = "running",
  SUCCEEDED = "succeeded",
  FAILED = "failed",
  SKIPPED = "skipped",
  CANCELLED = "cancelled",
}

export interface IHeartbeatRun {
  id: string;
  heartbeat_profile_id: string;
  status: HeartbeatRunStatus;
  due_at: Date;
  triggered_at: Date;
  started_at?: Date | null;
  finished_at?: Date | null;
  workflow_run_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  diagnostics_json?: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

export enum StandingOrderOverridePolicy {
  ADVISORY = "advisory",
  ALLOW_OVERRIDE = "allow_override",
  DENY_OVERRIDE = "deny_override",
}

export interface IStandingOrder {
  id: string;
  scopeId: string;
  title: string;
  instruction: string;
  profile_name?: string | null;
  enabled: boolean;
  priority: number;
  override_policy: StandingOrderOverridePolicy;
  created_by?: string | null;
  updated_by?: string | null;
  created_at: Date;
  updated_at: Date;
}
