export type GovernanceDecision = 'allow' | 'denied' | 'approval_required';

export type RuntimeExecutionStatus =
  | 'executed'
  | 'denied'
  | 'approval_required'
  | 'failed';

export interface AgentUserContext {
  userId?: string;
  roles?: string[];
  agentProfileName?: string;
}

export interface RuntimeContextInput {
  workflow_run_id?: string;
  job_id?: string;
  chat_session_id?: string;
  user?: AgentUserContext;
}

export interface RuntimeContext {
  workflowRunId: string | null;
  jobId: string | null;
  chatSessionId: string | null;
  user?: AgentUserContext;
}

export interface RuntimeActionResult {
  [key: string]: unknown;
  ok: boolean;
  action: string;
  execution_status: RuntimeExecutionStatus;
  workflow_run_id: string | null;
  job_id: string | null;
  reason?: string;
  denied_reason_code?: string;
  error?: string;
  result?: unknown;
}

export interface DeniedCapabilityInfo {
  reason?: string;
  reasonCode?: string;
}

export interface GovernanceEvaluationResult {
  status: GovernanceDecision;
  reason?: string;
  deniedReasonCode?: string;
}

export interface CreateToolCandidateParams extends RuntimeContextInput {
  tool_name: string;
  language: 'node' | 'python';
  source_code: string;
  schema: Record<string, unknown>;
  test_spec?: string;
}

export interface ToolArtifactParams extends RuntimeContextInput {
  artifact_id: string;
}

export interface UpsertToolParams extends RuntimeContextInput {
  name: string;
  schema: Record<string, unknown>;
  typescript_code: string;
  tier_restriction: number;
  language?: 'node' | 'python';
  publication_status?: 'draft' | 'validated' | 'published' | 'failed';
  published_artifact_id?: string | null;
  published_version?: number | null;
}

export interface CreateSkillParams extends RuntimeContextInput {
  name: string;
  description: string;
  skill_markdown: string;
}

export interface UpdateSkillParams extends RuntimeContextInput {
  skill_id: string;
  name?: string;
  skill_markdown?: string;
}

export interface SkillIdParams extends RuntimeContextInput {
  skill_id: string;
}

export interface UpsertSkillFileParams extends RuntimeContextInput {
  skill_id: string;
  relative_path: string;
  content?: string;
  content_base64?: string;
}

export interface DeleteSkillFileParams extends RuntimeContextInput {
  skill_id: string;
  relative_path: string;
}

export interface ReplaceProfileSkillsParams extends RuntimeContextInput {
  profile_id: string;
  skill_ids: string[];
}

export interface AddProfileSkillsParams extends RuntimeContextInput {
  profile_id: string;
  skill_ids: string[];
}

export interface RemoveProfileSkillsParams extends RuntimeContextInput {
  profile_id: string;
  skill_ids: string[];
}

export interface SaveScriptAsSkillParams extends RuntimeContextInput {
  name: string;
  description: string;
  script_content: string;
  relative_path?: string;
  profile_id?: string;
  overwrite_existing?: boolean;
}

export interface CreateArtifactParams extends RuntimeContextInput {
  artifact_id?: string;
  name: string;
  description: string;
  scope?: 'global' | 'profile';
  owner_profile?: string;
  metadata?: Record<string, unknown>;
}

export interface ListArtifactsParams extends RuntimeContextInput {
  query?: string;
  scope?: 'global' | 'profile';
  owner_profile?: string;
}

export interface ArtifactIdParams extends RuntimeContextInput {
  artifact_id: string;
}

export interface UpsertArtifactFileParams extends RuntimeContextInput {
  artifact_id: string;
  relative_path: string;
  content?: string;
  content_base64?: string;
}

export interface DeleteArtifactFileParams extends RuntimeContextInput {
  artifact_id: string;
  relative_path: string;
}

export interface SaveScriptAsArtifactParams extends RuntimeContextInput {
  artifact_id?: string;
  name: string;
  description: string;
  script_content: string;
  relative_path?: string;
  scope?: 'global' | 'profile';
  owner_profile?: string;
}
