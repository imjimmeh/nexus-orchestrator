import type { CreateSessionInviteTarget } from './chat-sessions.session-start.types';

export function resolveCreateSessionInviteTargets(params: {
  ownerProfile: string;
  collaboratorProfiles: string[];
  moderatorProfile: string | null;
}): CreateSessionInviteTarget[] {
  const inviteTargets: CreateSessionInviteTarget[] =
    params.collaboratorProfiles.map((profileName) => ({
      agent_profile: profileName,
      role: 'participant',
    }));

  const normalizedModerator = params.moderatorProfile?.trim();
  if (
    !normalizedModerator ||
    normalizedModerator === params.ownerProfile ||
    inviteTargets.some((target) => target.agent_profile === normalizedModerator)
  ) {
    return inviteTargets;
  }

  return [
    ...inviteTargets,
    {
      agent_profile: normalizedModerator,
      role: 'moderator',
    },
  ];
}
