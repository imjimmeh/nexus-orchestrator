export interface ChatCollaborationParticipantDto {
  id?: string;
  agentProfile?: string;
  role?: string;
  participationStatus?: string;
  invitedBy?: string | null;
  joinedAt?: string | null;
  leftAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ChatCollaborationLifecycleEventDto {
  event_type?: string;
  payload?: Record<string, unknown>;
}

export interface ChatCollaborationInviteResponseData {
  status?: 'accepted' | 'denied';
  chatSessionId?: string;
  participant?: ChatCollaborationParticipantDto | null;
  denialReason?: string | null;
  lifecycleEvents?: ChatCollaborationLifecycleEventDto[];
}

export interface ChatCollaborationInviteResponseEnvelope {
  success?: boolean;
  data?: ChatCollaborationInviteResponseData;
  message?: string;
}

export interface ChatCollaborationInviteResult {
  status: 'accepted' | 'denied';
  chat_session_id: string;
  participant?: {
    id: string;
    agent_profile: string;
    role: string;
    participation_status: string;
    invited_by: string | null;
    joined_at: string | null;
    left_at: string | null;
    created_at: string;
    updated_at: string;
  };
  denial_reason?: string;
  lifecycle_events: Array<{
    event_type: string;
    payload: Record<string, unknown>;
  }>;
}
