import { toDbArray } from './gitops-object.helpers';

type AgentProfileSource = 'seeded' | 'admin' | 'agent_factory' | 'repository';
type AgentProfileStrategy = 'merge' | 'replace';

interface AgentProfileAssignmentResolved {
  strategy: AgentProfileStrategy;
  systemPrompt: string | null;
  modelName: string | null;
  providerName: string | null;
  providerId: string | null;
  providerSource: 'global' | 'user' | 'scope' | null;
  tierPreference: string | null;
  supportsVision: boolean | null;
  allowedMountAliases: string[] | null;
  deniedMountAliases: string[] | null;
  allowRwMountAliases: string[] | null;
  assignedSkills: string[] | null;
  source: AgentProfileSource;
  locked: boolean;
  overrides: Record<string, unknown> | null;
  baseRef: string | null;
  baseProfileId: string | null;
  toolPolicy: Record<string, unknown> | null;
  managedRevision: string | null;
  lastGitHash: string | null;
  syncState: string | null;
}

export function buildAgentProfileAssignments(
  resolved: AgentProfileAssignmentResolved,
  managedBindingId: string | null,
): Array<[string, unknown]> {
  const shared: Array<[string, unknown]> = [
    ['source', 'repository'],
    ['locked', resolved.locked],
    ['managed_revision', resolved.managedRevision],
    ['last_git_hash', resolved.lastGitHash],
    ['sync_state', resolved.syncState],
    ['managed_binding_id', managedBindingId],
  ];

  if (resolved.strategy === 'merge') {
    return [
      ...shared,
      ['overrides', resolved.overrides],
      ['base_ref', resolved.baseRef],
      ['base_profile_id', resolved.baseProfileId],
      ['tool_policy', resolved.toolPolicy],
    ];
  }

  return [
    ['system_prompt', resolved.systemPrompt],
    ['model_name', resolved.modelName],
    ['provider_name', resolved.providerName],
    ['provider_id', resolved.providerId],
    ['provider_source', resolved.providerSource],
    ['tier_preference', resolved.tierPreference],
    ['supports_vision', resolved.supportsVision],
    ['allowed_mount_aliases', toDbArray(resolved.allowedMountAliases)],
    ['denied_mount_aliases', toDbArray(resolved.deniedMountAliases)],
    ['allow_rw_mount_aliases', toDbArray(resolved.allowRwMountAliases)],
    ['assigned_skills', toDbArray(resolved.assignedSkills)],
    ...shared,
    ['overrides', null],
    ['base_ref', null],
    ['base_profile_id', null],
    ['tool_policy', resolved.toolPolicy],
  ];
}
