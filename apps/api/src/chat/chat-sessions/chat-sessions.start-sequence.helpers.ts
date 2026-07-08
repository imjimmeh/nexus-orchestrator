import { ConflictException } from '@nestjs/common';
import { ChatSessionStatus } from '@nexus/core';
import type { CreateSessionInviteTarget } from './chat-sessions.session-start.types';

export async function initializeParticipantsAndStartSession(params: {
  sessionId: string;
  invitedBy: string | null;
  inviteTargets: CreateSessionInviteTarget[];
  initializeSessionParticipants: (params: {
    chatSessionId: string;
    primaryAgentProfile: string;
    participantProfiles: string[];
    moderatorProfile: string | null;
    invitedBy?: string | null;
  }) => Promise<void>;
  primaryProfileName: string;
  inviteParticipant: (params: {
    chatSessionId: string;
    targetAgentProfile: string;
    role?: 'participant' | 'moderator' | 'owner';
    invitedBy?: string | null;
    metadata?: Record<string, unknown> | null;
  }) => Promise<{ status: 'accepted' | 'denied'; denial_reason?: string }>;
  enqueueOwnerSession: () => Promise<void>;
  cancelSession: (params: {
    sessionId: string;
    message: string;
    completedAt: Date;
  }) => Promise<void>;
}): Promise<void> {
  try {
    await params.initializeSessionParticipants({
      chatSessionId: params.sessionId,
      primaryAgentProfile: params.primaryProfileName,
      participantProfiles: [],
      moderatorProfile: null,
      invitedBy: params.invitedBy,
    });

    for (const inviteTarget of params.inviteTargets) {
      const inviteResult = await params.inviteParticipant({
        chatSessionId: params.sessionId,
        targetAgentProfile: inviteTarget.agent_profile,
        role: inviteTarget.role,
        invitedBy: params.invitedBy,
        metadata: {
          source: 'session_create',
        },
      });
      if (inviteResult.status !== 'accepted') {
        throw new ConflictException(
          `Participant invite denied for ${inviteTarget.agent_profile}: ${
            inviteResult.denial_reason ?? 'unknown_denial_reason'
          }`,
        );
      }
    }

    await params.enqueueOwnerSession();
  } catch (error) {
    await params.cancelSession({
      sessionId: params.sessionId,
      message: (error as Error).message,
      completedAt: new Date(),
    });
    throw error;
  }
}

export function buildCancelledSessionUpdate(params: {
  message: string;
  completedAt: Date;
}): {
  status: ChatSessionStatus.CANCELLED;
  execution_state: 'cancelled';
  error_message: string;
  completed_at: Date;
} {
  return {
    status: ChatSessionStatus.CANCELLED,
    execution_state: 'cancelled',
    error_message: params.message,
    completed_at: params.completedAt,
  };
}
