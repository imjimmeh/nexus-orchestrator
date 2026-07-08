export type CapabilityTransport =
  | 'api_callback'
  | 'mounted_tool'
  | 'runner_local'
  | 'websocket_bridge';

export type CapabilityPolicyTag =
  | 'read_only'
  | 'mutating'
  | 'approval_gated'
  | 'diagnostic'
  | 'context'
  | 'state';

export type CapabilityModeOutcome = 'allow' | 'deny' | 'require_approval';

export type MutatingActionUnion =
  | 'invoke_agent_workflow'
  | 'update_project_strategy'
  | 'create_agent_profile'
  | 'complete_orchestration'
  | 'create_project_goal'
  | 'update_project_goal'
  | 'update_project_goal_status'
  | 'reorder_project_goals'
  | 'archive_project_goal'
  | 'unarchive_project_goal'
  | 'create_tool_candidate'
  | 'validate_tool_candidate'
  | 'publish_tool_candidate'
  | 'upsert_tool'
  | 'create_skill'
  | 'update_skill'
  | 'upsert_skill_file'
  | 'delete_skill_file'
  | 'replace_profile_skills'
  | 'add_profile_skills'
  | 'remove_profile_skills'
  | 'save_script_as_skill'
  | 'create_artifact'
  | 'upsert_artifact_file'
  | 'delete_artifact_file'
  | 'save_script_as_artifact'
  | 'create_workflow_definition'
  | 'update_workflow_definition'
  | 'delete_workflow_definition'
  | 'create_scheduled_job'
  | 'update_scheduled_job'
  | 'pause_scheduled_job'
  | 'resume_scheduled_job'
  | 'run_scheduled_job_now'
  | 'delete_scheduled_job';

export type { DiscoveredCapabilityDefinition } from './capability-registry.types';

export interface CapabilityManifestEntry {
  name: string;
  tierRestriction: 1 | 2;
  schema: Record<string, unknown>;
  transport: CapabilityTransport;
  policyTags: CapabilityPolicyTag[];
  description: string;
  typescriptCode: string;
  apiCallback?: {
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    pathTemplate: string;
    bodyMapping?: Record<string, string>;
  };
  bridgeAction?: string;
  runtimeOwner: 'api' | 'runner';
  seedInRegistry?: boolean;
  mutatingAction?: MutatingActionUnion;
  modeBehavior?: {
    autonomous?: CapabilityModeOutcome;
    supervised?: CapabilityModeOutcome;
    notifications_only?: CapabilityModeOutcome;
  };
}
