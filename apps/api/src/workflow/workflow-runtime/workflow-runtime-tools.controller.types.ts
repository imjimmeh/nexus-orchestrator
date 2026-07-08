import type { Request } from 'express';
import type {
  CheckSubagentStatusInput,
  IHostMountRequest,
  SpawnSubagentAsyncInput,
  WaitForSubagentsInput,
} from '@nexus/core';
import type { InvokeAgentWorkflowParams } from './workflow-runtime-orchestration-actions.service.types';

export type {
  BrowserArtifactGetBody,
  BrowserArtifactListBody,
  BrowserClosePageBody,
  BrowserRuntimeActionBody,
  CreateScheduleBody,
  GetAgentProfileBody,
  GetAgentProfilesBody,
  GetCapabilitiesBody,
  ManageTodoListBody,
  QueryMemoryBody,
  RecordInvestigationFindingBody,
  ScheduleIdentityBody,
  ScheduleListBody,
  ScheduleRunsBody,
  ListAgentProfileNamesBody,
  UpdateScheduleBody,
  ValidateSpecsBody,
  WorkflowIdentityBody,
  WorkflowListBody,
  WorkflowMutationBody,
  WorkflowUpdateBody,
} from '@nexus/core';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId?: string;
    roles?: string[];
    agentProfileName?: string;
    workflowRunId?: string;
    stepId?: string;
    jobId?: string;
    scopeId?: string;
    isSubagent?: boolean;
    subagentExecutionId?: string;
    parentJobId?: string;
    allowedTools?: string[];
  };
}

export interface GetChatCapabilitiesBody {
  chat_session_id: string;
  agent_profile_name: string;
  scope_id?: string;
}

export interface GetContextItemsBody {
  scope_id: string;
  status?: string;
}

export interface RuntimeTodoListItemInput {
  id?: string;
  title?: string;
  status: 'not-started' | 'in-progress' | 'completed';
  source_context_item_id?: string;
}

export interface GetTodoListBody {
  workflow_run_id?: string;
}

export type GetOrchestrationTimelineBody = {
  scope_id: string;
  workflow_run_id?: string;
};

export interface RuntimeCapabilityContextBody {
  workflow_run_id?: string;
  job_id?: string;
}

export interface RuntimeInternalToolCallBody extends RuntimeCapabilityContextBody {
  tool_name: string;
  payload: Record<string, unknown>;
  scope_id?: string;
}

export interface RuntimeGovernanceCheckBody extends RuntimeCapabilityContextBody {
  tool_name: string;
  payload: Record<string, unknown>;
  chat_session_id?: string;
}

/** Alias: only `workflow_id` is used by the delete endpoint. */
export type WorkflowDeleteBody = import('@nexus/core').WorkflowIdentityBody;

/** Alias: only `scheduled_job_id` is used by pause/resume/delete endpoints. */
export type MutateScheduleBody = import('@nexus/core').ScheduleIdentityBody;

export interface CreateToolCandidateBody extends RuntimeCapabilityContextBody {
  tool_name: string;
  language: 'node' | 'python';
  source_code: string;
  schema: Record<string, unknown>;
  test_spec?: string;
}

export interface UpsertToolBody extends RuntimeCapabilityContextBody {
  name: string;
  schema: Record<string, unknown>;
  typescript_code: string;
  tier_restriction: number;
  language?: 'node' | 'python';
  publication_status?: 'draft' | 'validated' | 'published' | 'failed';
  published_artifact_id?: string | null;
  published_version?: number | null;
}

export interface CreateSkillBody extends RuntimeCapabilityContextBody {
  name: string;
  description: string;
  skill_markdown: string;
}

export interface UpdateSkillBody extends RuntimeCapabilityContextBody {
  name?: string;
  skill_markdown?: string;
}

export type ListSkillFilesBody = RuntimeCapabilityContextBody;

export interface UpsertSkillFileBody extends RuntimeCapabilityContextBody {
  relative_path: string;
  content?: string;
  content_base64?: string;
}

export interface DeleteSkillFileBody extends RuntimeCapabilityContextBody {
  relative_path: string;
}

export interface ReplaceProfileSkillsBody extends RuntimeCapabilityContextBody {
  skill_ids: string[];
}

export type OrchestrationInvokeAgentWorkflowBody = InvokeAgentWorkflowParams;

export interface OrchestrationInvokeAgentBody {
  scope_id: string;
  agent_profile: string;
  task_prompt?: string;
  trigger_data?: Record<string, unknown>;
  reasoning?: string;
  workflow_run_id?: string;
  requested_by?: string;
}

export interface GetOrchestrationStateBody {
  scope_id: string;
}

export interface UpdateOrchestrationStateBody {
  scope_id: string;
  patch: Record<string, unknown>;
}

export interface YieldSessionBody {
  scope_id: string;
  workflow_run_id: string;
  active_playbook?: string;
  status: 'completed' | 'blocked' | 'partial' | 'recovered' | 'escalated';
  summary: string;
  recommended_next_playbook?: string;
  notes?: string;
}

export interface ListPathBody {
  scope_id: string;
  relative_path?: string;
}

export type SubagentSpawnAsyncBody = Omit<SpawnSubagentAsyncInput, 'action'> & {
  host_mounts?: IHostMountRequest[];
  inherit_host_mounts?: boolean;
};

export type SubagentWaitBody = Omit<WaitForSubagentsInput, 'action'>;

export type SubagentStatusBody = Omit<CheckSubagentStatusInput, 'action'>;

export interface CreateDelegationContractBody {
  objective: string;
  task_prompt?: string;
  success_criteria?: string[];
  agent_profile: string;
  tools: string[];
  tier: 'light' | 'heavy';
  assigned_files?: string[];
  allowed_tools?: string[];
  denied_tools?: string[];
  token_budget?: number;
  time_budget_ms?: number;
  max_retries?: number;
  queue_priority?: number;
  escalation_path?: string[];
  expected_artifacts?: string[];
  metadata?: Record<string, unknown>;
  parent_delegation_id?: string;
  parent_trace_id?: string;
  allow_privileged_tools?: boolean;
}

export interface DelegationContractIdentityBody {
  contract_id: string;
}

export interface CancelDelegationContractBody extends DelegationContractIdentityBody {
  reason?: string;
}

export interface DelegationReplayBody {
  limit?: number;
  offset?: number;
}
