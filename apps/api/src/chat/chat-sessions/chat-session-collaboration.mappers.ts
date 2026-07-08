import type { ChatSessionParticipantRole } from '../database/entities/chat-session-participant.entity.types';
import type {
  ChatParticipantSummary,
  CollaborationLifecycleEvent,
} from './chat-session-collaboration.types';

export function buildInviteEvent(params: {
  chatSessionId: string;
  scopeId: string | null;
  participantId: string;
  targetAgentProfile: string;
  role: ChatSessionParticipantRole;
  invitedBy: string | null;
}): CollaborationLifecycleEvent {
  return {
    event_type: 'chat_participant_invited',
    payload: {
      chat_session_id: params.chatSessionId,
      scope_id: params.scopeId,
      participant_id: params.participantId,
      agent_profile: params.targetAgentProfile,
      role: params.role,
      invited_by: params.invitedBy,
    },
  };
}

export function buildActivatedEvent(params: {
  chatSessionId: string;
  scopeId: string | null;
  participantId: string;
  targetAgentProfile: string;
  activationJobId: string;
}): CollaborationLifecycleEvent {
  return {
    event_type: 'chat_participant_activated',
    payload: {
      chat_session_id: params.chatSessionId,
      scope_id: params.scopeId,
      participant_id: params.participantId,
      agent_profile: params.targetAgentProfile,
      activation_job_id: params.activationJobId,
    },
  };
}

export function mapChatParticipantSummary(participant: {
  id: string;
  agent_profile: string;
  role: ChatSessionParticipantRole;
  participation_status: string;
  invited_by?: string | null;
  joined_at?: Date | string | null;
  left_at?: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}): ChatParticipantSummary {
  return {
    id: participant.id,
    agent_profile: participant.agent_profile,
    role: participant.role,
    participation_status:
      participant.participation_status as ChatParticipantSummary['participation_status'],
    invited_by: participant.invited_by ?? null,
    joined_at: toOptionalIsoString(participant.joined_at),
    left_at: toOptionalIsoString(participant.left_at),
    created_at: toRequiredIsoString(participant.created_at),
    updated_at: toRequiredIsoString(participant.updated_at),
  };
}

function toOptionalIsoString(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function toRequiredIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
