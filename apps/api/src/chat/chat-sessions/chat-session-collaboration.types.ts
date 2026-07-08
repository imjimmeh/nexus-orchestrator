import type {
  ChatSessionParticipantRole,
  ChatSessionParticipationStatus,
} from '../database/entities/chat-session-participant.entity.types';

export interface CollaborationLifecycleEvent {
  event_type: string;
  payload: Record<string, unknown>;
}

export interface ChatParticipantSummary {
  id: string;
  agent_profile: string;
  role: ChatSessionParticipantRole;
  participation_status: ChatSessionParticipationStatus;
  invited_by: string | null;
  joined_at: string | null;
  left_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InviteChatParticipantResult {
  status: 'accepted' | 'denied';
  chat_session_id: string;
  participant?: ChatParticipantSummary;
  denial_reason?: string;
  lifecycle_events: CollaborationLifecycleEvent[];
}

export interface ChatSessionCollaborationState {
  status: 'found';
  chat_session_id: string;
  scope_id: string | null;
  session_status: string;
  participant_count: number;
  active_participant_count: number;
  invited_participant_count: number;
  participants: ChatParticipantSummary[];
}
