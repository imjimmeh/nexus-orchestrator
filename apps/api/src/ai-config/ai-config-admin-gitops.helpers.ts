import type { ProfileCrudService } from './services/crud';
import type { GitOpsEditPolicyService } from '../gitops/gitops-edit-policy.service';
import type { GitOpsPendingChangeService } from '../gitops/gitops-pending-change.service';

export async function loadProfileForGitOpsPolicy(
  profileCrudService: ProfileCrudService,
  gitOpsEditPolicy: GitOpsEditPolicyService | undefined,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!gitOpsEditPolicy) {
    return null;
  }

  const profile = await profileCrudService.findById(id);
  return profile ? (profile as unknown as Record<string, unknown>) : null;
}

export function evaluateExistingProfileEdit(
  gitOpsEditPolicy: GitOpsEditPolicyService | undefined,
  profile: Record<string, unknown>,
) {
  return gitOpsEditPolicy?.evaluateExisting({
    objectType: 'agent_profile',
    managedBy: getStringField(profile, 'managedBy', 'managed_by'),
    managedBindingId: getStringField(
      profile,
      'managedBindingId',
      'managed_binding_id',
    ),
    locked: profile['locked'] === true,
  });
}

export async function recordProfilePendingChange(
  gitOpsPendingChanges: GitOpsPendingChangeService | undefined,
  decision: { action: string; binding?: unknown },
  profile: Record<string, unknown> | null,
  payload: Record<string, unknown>,
  actorId: string | undefined,
  changeType: string,
): Promise<void> {
  if (
    decision.action !== 'allow_with_pending_change' ||
    !decision.binding ||
    !gitOpsPendingChanges
  ) {
    return;
  }

  const binding = decision.binding as Parameters<
    GitOpsPendingChangeService['recordConfigObjectChange']
  >[0]['binding'] & { scopeNodeId?: string };
  const scopeNodeId =
    getStringField(profile, 'scope_node_id', 'scopeNodeId') ??
    binding.scopeNodeId;
  const name = getStringField(profile, 'name');
  if (!scopeNodeId || !name) {
    return;
  }

  await gitOpsPendingChanges.recordConfigObjectChange({
    binding,
    objectType: 'agent_profile',
    scopeNodeId,
    name,
    changeType,
    payload,
    actorId,
  });
}

function getStringField(
  value: Record<string, unknown> | null,
  ...keys: string[]
): string | null {
  for (const key of keys) {
    const candidate = value?.[key];
    if (typeof candidate === 'string') {
      return candidate;
    }
  }
  return null;
}
