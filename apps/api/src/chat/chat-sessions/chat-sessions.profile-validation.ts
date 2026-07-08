import { NotFoundException } from '@nestjs/common';
import type { CreateChatSessionInput } from './chat-sessions.types';

export function extractParticipantProfileNames(
  participants: CreateChatSessionInput['participants'],
): string[] {
  if (!participants || participants.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const profiles: string[] = [];

  for (const participant of participants) {
    const profileName = participant.agent_profile.trim();
    if (!profileName || seen.has(profileName)) {
      continue;
    }

    seen.add(profileName);
    profiles.push(profileName);
  }

  return profiles;
}

export async function assertParticipantProfilesAvailable(params: {
  participantProfiles: string[];
  moderatorProfile: string | null;
  primaryAgentProfile: string;
  findActiveAgentProfileByName: (profileName: string) => Promise<unknown>;
}): Promise<void> {
  const profilesToValidate = new Set<string>();

  for (const profileName of params.participantProfiles) {
    profilesToValidate.add(profileName);
  }

  const moderatorProfile = params.moderatorProfile?.trim();
  if (moderatorProfile) {
    profilesToValidate.add(moderatorProfile);
  }

  profilesToValidate.delete(params.primaryAgentProfile);

  for (const profileName of profilesToValidate) {
    const profile = await params.findActiveAgentProfileByName(profileName);
    if (!profile) {
      throw new NotFoundException(
        `Agent profile '${profileName}' not found or inactive`,
      );
    }
  }
}
