import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChatSessionJobData } from '@nexus/core';
import { Queue } from 'bullmq';
import type { ChatSession } from '../database/entities/chat-session.entity';
import type { ChatSessionParticipant } from '../database/entities/chat-session-participant.entity';
import type { ChatSessionParticipantRole } from '../database/entities/chat-session-participant.entity.types';
import { ChatSessionParticipantRepository } from '../database/repositories/chat-session-participant.repository';
import { ChatSessionRepository } from '../database/repositories/chat-session.repository';
import { ChatCoreLookupService } from '../chat-actions/chat-core-lookup.service';
import {
  buildActivatedEvent,
  buildInviteEvent,
  mapChatParticipantSummary,
} from './chat-session-collaboration.mappers';
import {
  buildParticipantRoleByProfile,
  upsertInitialParticipants,
} from './chat-session-collaboration.participant-setup.helpers';
import { resolveInviteLimitDenialReason } from './chat-session-collaboration.rules';
import { sanitizeForJobId } from './chat-session-collaboration.utils';
import type {
  ChatSessionCollaborationState,
  CollaborationLifecycleEvent,
  InviteChatParticipantResult,
} from './chat-session-collaboration.types';

@Injectable()
export class ChatSessionCollaborationService {
  private readonly logger = new Logger(ChatSessionCollaborationService.name);
  private static readonly LIGHT_TIER = 1;
  private static readonly HEAVY_TIER = 2;
  private static readonly MAX_JOB_ID_LENGTH = 120;

  constructor(
    private readonly chatSessionRepo: ChatSessionRepository,
    private readonly chatParticipantRepo: ChatSessionParticipantRepository,
    private readonly coreLookups: ChatCoreLookupService,
    @InjectQueue('chat-sessions')
    private readonly chatQueue: Queue<ChatSessionJobData>,
  ) {}

  async initializeSessionParticipants(params: {
    chatSessionId: string;
    primaryAgentProfile: string;
    participantProfiles?: string[];
    moderatorProfile?: string | null;
    invitedBy?: string | null;
  }): Promise<void> {
    const session = await this.getRequiredSession(params.chatSessionId);
    const participantRoleByProfile = buildParticipantRoleByProfile(params);

    await upsertInitialParticipants({
      chatParticipantRepo: this.chatParticipantRepo,
      assertAgentProfileActive: async (profileName) =>
        this.assertAgentProfileActive(profileName),
      chatSessionId: params.chatSessionId,
      scopeId: session.scopeId ?? null,
      participantRoleByProfile,
      invitedBy: params.invitedBy ?? 'ui:session_setup',
    });
  }

  async listParticipants(chatSessionId: string) {
    await this.getRequiredSession(chatSessionId);
    return this.chatParticipantRepo.findByChatSessionId(chatSessionId);
  }

  async getSessionState(
    chatSessionId: string,
  ): Promise<ChatSessionCollaborationState> {
    const session = await this.getRequiredSession(chatSessionId);
    const participants =
      await this.chatParticipantRepo.findByChatSessionId(chatSessionId);

    return {
      status: 'found',
      chat_session_id: chatSessionId,
      scope_id: session.scopeId ?? null,
      session_status: session.status,
      participant_count: participants.length,
      active_participant_count: participants.filter(
        (participant) => participant.participation_status === 'active',
      ).length,
      invited_participant_count: participants.filter(
        (participant) => participant.participation_status === 'invited',
      ).length,
      participants: participants.map((participant) =>
        mapChatParticipantSummary(participant),
      ),
    };
  }

  async inviteParticipant(params: {
    chatSessionId: string;
    targetAgentProfile: string;
    role?: ChatSessionParticipantRole;
    invitedBy?: string | null;
    metadata?: Record<string, unknown> | null;
  }): Promise<InviteChatParticipantResult> {
    const session = await this.getRequiredSession(params.chatSessionId);
    const inviteInput = this.normalizeInviteInput(params);

    const denialReason = await this.resolveInviteDenialReason({
      chatSessionId: params.chatSessionId,
      targetAgentProfile: inviteInput.targetAgentProfile,
    });

    if (denialReason) {
      return this.publishDeniedResult({
        chatSessionId: params.chatSessionId,
        scopeId: session.scopeId ?? null,
        targetAgentProfile: inviteInput.targetAgentProfile,
        invitedBy: inviteInput.invitedBy,
        denialReason,
      });
    }

    return this.publishAcceptedInviteResult({
      chatSessionId: params.chatSessionId,
      scopeId: session.scopeId ?? null,
      targetAgentProfile: inviteInput.targetAgentProfile,
      role: inviteInput.role,
      invitedBy: inviteInput.invitedBy,
      metadata: inviteInput.metadata,
      session,
    });
  }

  private normalizeInviteInput(params: {
    targetAgentProfile: string;
    role?: ChatSessionParticipantRole;
    invitedBy?: string | null;
    metadata?: Record<string, unknown> | null;
  }): {
    targetAgentProfile: string;
    role: ChatSessionParticipantRole;
    invitedBy: string | null;
    metadata: Record<string, unknown> | null;
  } {
    return {
      targetAgentProfile: params.targetAgentProfile.trim(),
      role: params.role ?? 'participant',
      invitedBy: params.invitedBy?.trim() || null,
      metadata: params.metadata ?? null,
    };
  }

  private async publishAcceptedInviteResult(params: {
    chatSessionId: string;
    scopeId: string | null;
    targetAgentProfile: string;
    role: ChatSessionParticipantRole;
    invitedBy: string | null;
    metadata: Record<string, unknown> | null;
    session: ChatSession;
  }): Promise<InviteChatParticipantResult> {
    const participant = await this.upsertInvitedParticipant({
      chatSessionId: params.chatSessionId,
      targetAgentProfile: params.targetAgentProfile,
      role: params.role,
      invitedBy: params.invitedBy,
      metadata: params.metadata,
    });

    const activatedParticipant = await this.activateInvitedParticipant({
      participantId: participant.id,
      chatSessionId: params.chatSessionId,
      targetAgentProfile: params.targetAgentProfile,
      role: params.role,
      invitedBy: params.invitedBy,
      metadata: participant.metadata ?? params.metadata,
      session: params.session,
    });

    const lifecycleEvents: CollaborationLifecycleEvent[] = [
      buildInviteEvent({
        chatSessionId: params.chatSessionId,
        scopeId: params.scopeId,
        participantId: participant.id,
        targetAgentProfile: params.targetAgentProfile,
        role: params.role,
        invitedBy: params.invitedBy,
      }),
      buildActivatedEvent({
        chatSessionId: params.chatSessionId,
        scopeId: params.scopeId,
        participantId: participant.id,
        targetAgentProfile: params.targetAgentProfile,
        activationJobId: activatedParticipant.activationJobId,
      }),
    ];

    return {
      status: 'accepted',
      chat_session_id: params.chatSessionId,
      participant: mapChatParticipantSummary(activatedParticipant.participant),
      lifecycle_events: lifecycleEvents,
    };
  }

  private async activateInvitedParticipant(params: {
    participantId: string;
    chatSessionId: string;
    targetAgentProfile: string;
    role: ChatSessionParticipantRole;
    invitedBy: string | null;
    metadata: Record<string, unknown> | null;
    session: ChatSession;
  }): Promise<{
    participant: ChatSessionParticipant;
    activationJobId: string;
  }> {
    const targetProfile = await this.coreLookups.findActiveAgentProfileByName(
      params.targetAgentProfile,
    );
    if (!targetProfile) {
      throw new NotFoundException(
        `Agent profile '${params.targetAgentProfile}' not found or inactive`,
      );
    }

    const activationJobId = this.buildActivationJobId(
      params.chatSessionId,
      targetProfile.name,
    );
    const activationPrompt =
      'You have been invited to collaborate in this active chat session. Introduce yourself briefly and continue from the latest context.';
    const containerTier =
      targetProfile.tier_preference?.trim().toLowerCase() === 'heavy'
        ? ChatSessionCollaborationService.HEAVY_TIER
        : ChatSessionCollaborationService.LIGHT_TIER;

    await this.chatQueue.add(
      `chat-session:${params.chatSessionId}:${targetProfile.name}:invite`,
      {
        chatSessionId: params.chatSessionId,
        agentProfileName: targetProfile.name,
        agentProfileId: targetProfile.id,
        contextId: params.session.scopeId ?? null,
        contextType: params.session.scopeId ? 'project' : null,
        initialMessage: activationPrompt,
        containerTier,
      },
      {
        jobId: activationJobId,
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );

    this.logger.log(
      `Activated invited participant ${targetProfile.name} for chat session ${params.chatSessionId} with job ${activationJobId}`,
    );

    const participant =
      await this.chatParticipantRepo.upsertByChatSessionAndAgentProfile(
        params.chatSessionId,
        params.targetAgentProfile,
        {
          role: params.role,
          participation_status: 'active',
          invited_by: params.invitedBy,
          joined_at: new Date(),
          left_at: null,
          metadata: params.metadata,
        },
      );

    return {
      participant,
      activationJobId,
    };
  }

  private buildActivationJobId(
    chatSessionId: string,
    agentProfileName: string,
  ): string {
    const sanitizedSessionId = sanitizeForJobId(chatSessionId);
    const sanitizedProfile = sanitizeForJobId(agentProfileName);
    const timestamp = Date.now().toString();
    const jobId = `${sanitizedSessionId}-${sanitizedProfile}-invite-${timestamp}`;

    if (jobId.length <= ChatSessionCollaborationService.MAX_JOB_ID_LENGTH) {
      return jobId;
    }

    const maxPrefixLength =
      ChatSessionCollaborationService.MAX_JOB_ID_LENGTH - timestamp.length - 8;
    const truncatedPrefix = jobId.slice(0, Math.max(1, maxPrefixLength));
    return `${truncatedPrefix}-${timestamp}`;
  }

  private async resolveInviteDenialReason(params: {
    chatSessionId: string;
    targetAgentProfile: string;
  }): Promise<string | null> {
    if (!(await this.isAgentProfileActive(params.targetAgentProfile))) {
      return 'target_agent_profile_not_active';
    }

    return resolveInviteLimitDenialReason({
      chatParticipantRepo: this.chatParticipantRepo,
      chatSessionId: params.chatSessionId,
      targetAgentProfile: params.targetAgentProfile,
    });
  }

  private async upsertInvitedParticipant(params: {
    chatSessionId: string;
    targetAgentProfile: string;
    role: ChatSessionParticipantRole;
    invitedBy: string | null;
    metadata: Record<string, unknown> | null;
  }): Promise<ChatSessionParticipant> {
    const existing =
      await this.chatParticipantRepo.findByChatSessionAndAgentProfile(
        params.chatSessionId,
        params.targetAgentProfile,
      );

    return this.chatParticipantRepo.upsertByChatSessionAndAgentProfile(
      params.chatSessionId,
      params.targetAgentProfile,
      {
        role: params.role,
        participation_status: 'invited',
        invited_by: params.invitedBy,
        joined_at: null,
        left_at: null,
        metadata:
          existing?.metadata || params.metadata
            ? {
                ...(existing?.metadata ?? undefined),
                ...(params.metadata ?? undefined),
              }
            : null,
      },
    );
  }

  private async getRequiredSession(chatSessionId: string) {
    const session = await this.chatSessionRepo.findById(chatSessionId);
    if (!session) {
      throw new NotFoundException(`Chat session '${chatSessionId}' not found`);
    }

    return session;
  }

  private async assertAgentProfileActive(profileName: string): Promise<void> {
    if (await this.isAgentProfileActive(profileName)) {
      return;
    }

    throw new NotFoundException(
      `Agent profile '${profileName}' not found or inactive`,
    );
  }

  private async isAgentProfileActive(profileName: string): Promise<boolean> {
    const profile =
      await this.coreLookups.findActiveAgentProfileByName(profileName);
    return !!profile;
  }

  private publishDeniedResult(params: {
    chatSessionId: string;
    scopeId: string | null;
    targetAgentProfile: string;
    invitedBy: string | null;
    denialReason: string;
  }): InviteChatParticipantResult {
    const lifecycleEvents: CollaborationLifecycleEvent[] = [
      {
        event_type: 'chat_participant_invite_denied',
        payload: {
          chat_session_id: params.chatSessionId,
          scope_id: params.scopeId,
          agent_profile: params.targetAgentProfile,
          invited_by: params.invitedBy,
          denial_reason: params.denialReason,
        },
      },
    ];

    return {
      status: 'denied',
      chat_session_id: params.chatSessionId,
      denial_reason: params.denialReason,
      lifecycle_events: lifecycleEvents,
    };
  }
}
