import type { ChatSessionParticipantRepository } from '../database/repositories/chat-session-participant.repository';

const CHAT_INVITE_MAX_PARTICIPANTS_DEFAULT = 6;
const CHAT_INVITE_MAX_INVITES_DEFAULT = 20;

export async function resolveInviteLimitDenialReason(params: {
  chatParticipantRepo: ChatSessionParticipantRepository;
  chatSessionId: string;
  targetAgentProfile: string;
}): Promise<string | null> {
  const existingParticipant =
    await params.chatParticipantRepo.findByChatSessionAndAgentProfile(
      params.chatSessionId,
      params.targetAgentProfile,
    );

  if (existingParticipant) {
    return null;
  }

  const [participantCount, inviteCount] = await Promise.all([
    params.chatParticipantRepo.countByChatSessionId(params.chatSessionId),
    params.chatParticipantRepo.countInvitesByChatSessionId(
      params.chatSessionId,
    ),
  ]);

  if (participantCount >= CHAT_INVITE_MAX_PARTICIPANTS_DEFAULT) {
    return 'participant_limit_reached_for_session';
  }

  if (inviteCount >= CHAT_INVITE_MAX_INVITES_DEFAULT) {
    return 'invite_rate_limit_exceeded_for_session';
  }

  return null;
}
