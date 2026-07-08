import { buildInviteEvent } from './chat-session-collaboration.mappers';
import type { ChatSessionParticipantRole } from '../database/entities/chat-session-participant.entity.types';
import type { ChatSessionParticipantRepository } from '../database/repositories/chat-session-participant.repository';
import type { CollaborationLifecycleEvent } from './chat-session-collaboration.types';

export function buildParticipantRoleByProfile(params: {
  primaryAgentProfile: string;
  participantProfiles?: string[];
  moderatorProfile?: string | null;
}): Map<string, ChatSessionParticipantRole> {
  const roleByProfile = new Map<string, ChatSessionParticipantRole>([
    [params.primaryAgentProfile, 'owner'],
  ]);

  for (const profileName of params.participantProfiles ?? []) {
    registerParticipantRole({
      roleByProfile,
      profileName,
      primaryAgentProfile: params.primaryAgentProfile,
      role: 'participant',
    });
  }

  registerParticipantRole({
    roleByProfile,
    profileName: params.moderatorProfile,
    primaryAgentProfile: params.primaryAgentProfile,
    role: 'moderator',
  });

  return roleByProfile;
}

export async function upsertInitialParticipants(params: {
  chatParticipantRepo: ChatSessionParticipantRepository;
  assertAgentProfileActive: (profileName: string) => Promise<void>;
  chatSessionId: string;
  scopeId: string | null;
  participantRoleByProfile: Map<string, ChatSessionParticipantRole>;
  invitedBy: string;
}): Promise<CollaborationLifecycleEvent[]> {
  const lifecycleEvents: CollaborationLifecycleEvent[] = [];
  const now = new Date();

  for (const [profileName, role] of params.participantRoleByProfile.entries()) {
    await params.assertAgentProfileActive(profileName);

    const participant =
      await params.chatParticipantRepo.upsertByChatSessionAndAgentProfile(
        params.chatSessionId,
        profileName,
        {
          role,
          participation_status: role === 'owner' ? 'active' : 'invited',
          invited_by: role === 'owner' ? null : params.invitedBy,
          joined_at: role === 'owner' ? now : null,
          left_at: null,
        },
      );

    if (role === 'owner') {
      continue;
    }

    lifecycleEvents.push(
      buildInviteEvent({
        chatSessionId: params.chatSessionId,
        scopeId: params.scopeId,
        participantId: participant.id,
        targetAgentProfile: profileName,
        role,
        invitedBy: participant.invited_by ?? null,
      }),
    );
  }

  return lifecycleEvents;
}

function registerParticipantRole(params: {
  roleByProfile: Map<string, ChatSessionParticipantRole>;
  profileName?: string | null;
  primaryAgentProfile: string;
  role: ChatSessionParticipantRole;
}): void {
  const normalized = params.profileName?.trim() ?? '';
  if (!normalized || normalized === params.primaryAgentProfile) {
    return;
  }

  if (params.role === 'participant' && params.roleByProfile.has(normalized)) {
    return;
  }

  params.roleByProfile.set(normalized, params.role);
}
