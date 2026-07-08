import type { IHostMountRequest } from '@nexus/core';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import type { WorkflowLifecycleStage } from '../workflow-stage-skill-policy.service.types';

export interface SubagentSpawnParams {
  agent_profile: string;
  task_prompt: string;
  tools: string[];
  tier?: 'light' | 'heavy';
  host_mounts?: IHostMountRequest[];
  inherit_host_mounts?: boolean;
  workflowRunId: string;
  parent_job_id?: string;
  /**
   * YAML id of the step that spawned this subagent (a step always has a
   * YAML id). Threaded through to the effective-skill resolver so
   * step-scoped `workflow_skill_bindings` and step-level YAML `inputs.skills`
   * reach the subagent the same way they reach the step executor — see
   * `subagent-orchestrator.skills.helpers.ts`.
   */
  parent_step_id?: string;
  lifecycle_stage?: WorkflowLifecycleStage | null;
  delegation_contract_id?: string;
  lineage_trace_id?: string;
  lineage_parent_trace_id?: string | null;
  model_override?: string;
  provider_override?: string;
  harness_override?: string;
  resumeSessionTreeId?: string;
}

export interface SubagentAsyncSpawnParams extends SubagentSpawnParams {
  assigned_files?: string[];
  /** Step role identifier — enforces at-most-one active subagent per (parent, role). */
  role?: string;
}

export interface SubagentExecutionResultFallback {
  status: SubagentExecutionView['status'];
}

export type NormalizedSubagentStatus =
  | 'spawning'
  | 'running'
  | 'completed'
  | 'failed';

export interface SubagentExecutionResultRecord
  extends Record<string, unknown>, SubagentExecutionResultFallback {
  failure_reason?: string;
  latest_response?: string;
  latest_stop_reason?: string;
  latest_turn_at?: string;
  started_at?: string;
  completed_at?: string;
}

export interface WaitForSubagentsOptions {
  executionIds?: string[];
  timeoutSeconds?: number;
}

export type SubagentResultMap = Record<string, SubagentExecutionResultRecord>;

export interface WaitForSubagentsResult {
  status: 'all_completed' | 'timeout';
  results: SubagentResultMap;
  pending_execution_ids?: string[];
  timeout_seconds?: number;
  elapsed_seconds?: number;
}

export interface SubagentStatusResult {
  execution_id: string;
  status: SubagentExecutionView['status'];
  normalized_status: NormalizedSubagentStatus;
  terminal: boolean;
  delegation_contract_id?: string;
  lineage_trace_id?: string;
  lineage_parent_trace_id?: string;
  failure_reason?: string;
  latest_response?: string;
  latest_stop_reason?: string;
  latest_turn_at?: Date;
  turn_count?: number;
  result?: Record<string, unknown>;
  assigned_files?: string[];
  started_at: Date;
  completed_at?: Date;
}
