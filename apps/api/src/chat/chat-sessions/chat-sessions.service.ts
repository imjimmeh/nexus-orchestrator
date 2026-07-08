/* eslint-disable max-lines */
import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ChatSessionSource,
  ChatSessionStatus,
  ChatSessionJobData,
  ChatSessionType,
} from '@nexus/core';
import { BudgetDecisionService } from '../../cost-governance/budget-decision.service';
import { ChatCoreLookupService } from '../chat-actions/chat-core-lookup.service';
import { ChatChannelRouteRepository } from '../database/repositories/chat-channel-route.repository';
import { ChatMessageRepository } from '../database/repositories/chat-message.repository';
import { ChatSessionRepository } from '../database/repositories/chat-session.repository';
import { ChatMemoryLifecycleService } from '../memory/chat-memory-lifecycle.service';
import { buildDeterministicSessionId } from './chat-session-id.helper';
import { ChatSessionCollaborationService } from './chat-session-collaboration.service';
import {
  buildChatSessionCreatePayload,
  buildChatSessionJobData,
  mapSessionSummaryDto,
  mapTimelineItems,
} from './chat-sessions.mappers';
import {
  assertParticipantProfilesAvailable,
  extractParticipantProfileNames,
} from './chat-sessions.profile-validation';
import { resolveCreateSessionInviteTargets } from './chat-sessions.session-start.helpers';
import {
  buildCancelledSessionUpdate,
  initializeParticipantsAndStartSession,
} from './chat-sessions.start-sequence.helpers';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type {
  ChannelSessionIdentityInput,
  ChannelSessionResolveInput,
  ChatMessageTimelineItem,
  ChatSessionDetailsDto,
  ChatSessionSummaryDto,
  CreateChannelSessionInput,
  CreateChatSessionInput,
  ListRecentChannelSessionsInput,
  ListChatSessionFilters,
  SetActiveChannelSessionInput,
} from './chat-sessions.types';

@Injectable()
export class ChatSessionsService {
  private readonly logger = new Logger(ChatSessionsService.name);
  private static readonly LIGHT_TIER = 1;
  private static readonly HEAVY_TIER = 2;

  constructor(
    private readonly chatSessions: ChatSessionRepository,
    private readonly chatChannelRoutes: ChatChannelRouteRepository,
    private readonly chatMessages: ChatMessageRepository,
    private readonly coreLookups: ChatCoreLookupService,
    private readonly memoryLifecycle: ChatMemoryLifecycleService,
    private readonly chatCollaboration: ChatSessionCollaborationService,
    @InjectQueue('chat-sessions')
    private readonly chatQueue: Queue<ChatSessionJobData>,
    private readonly budgetDecisionService: BudgetDecisionService,
  ) {}

  async createSession(
    input: CreateChatSessionInput,
  ): Promise<ChatSessionSummaryDto> {
    const profile = await this.requireActiveProfile(input.agentProfileName);
    await this.assertProjectExists(input.scopeId ?? null);

    const participantProfiles = extractParticipantProfileNames(
      input.participants,
    );
    await assertParticipantProfilesAvailable({
      participantProfiles,
      moderatorProfile: input.moderatorProfile ?? null,
      primaryAgentProfile: profile.name,
      findActiveAgentProfileByName:
        this.coreLookups.findActiveAgentProfileByName.bind(this.coreLookups),
    });
    const collaboratorProfiles = participantProfiles.filter(
      (profileName) => profileName !== profile.name,
    );
    const inviteTargets = resolveCreateSessionInviteTargets({
      ownerProfile: profile.name,
      collaboratorProfiles,
      moderatorProfile: input.moderatorProfile ?? null,
    });

    const created = await this.chatSessions.create(
      buildChatSessionCreatePayload({
        profile,
        status: ChatSessionStatus.STARTING,
        executionState: 'starting',
        source: ChatSessionSource.AD_HOC,
        initialMessage: input.initialMessage,
        displayName: input.displayName ?? null,
        scopeId: input.scopeId ?? null,
        sessionType: input.sessionType ?? ChatSessionType.GENERAL,
      }),
    );

    await initializeParticipantsAndStartSession({
      sessionId: created.id,
      primaryProfileName: profile.name,
      invitedBy: input.invitedBy ?? null,
      inviteTargets,
      initializeSessionParticipants:
        this.chatCollaboration.initializeSessionParticipants.bind(
          this.chatCollaboration,
        ),
      inviteParticipant: this.chatCollaboration.inviteParticipant.bind(
        this.chatCollaboration,
      ),
      enqueueOwnerSession: () =>
        this.enqueueChatSessionJob(
          {
            id: created.id,
            agent_profile_name: created.agent_profile_name,
            agent_profile_id: created.agent_profile_id,
            scopeId: created.scopeId ?? null,
            initial_message: created.initial_message,
          },
          profile,
        ),
      cancelSession: async ({ sessionId, message, completedAt }) => {
        await this.chatSessions.update(
          sessionId,
          buildCancelledSessionUpdate({
            message,
            completedAt,
          }),
        );
      },
    });

    return this.mapSessionSummary(created);
  }

  async createAndActivateChannelSession(
    input: CreateChannelSessionInput,
  ): Promise<ChatSessionSummaryDto> {
    const created = await this.createSession({
      agentProfileName: input.agentProfileName,
      scopeId: input.scopeId ?? null,
      initialMessage: input.initialMessage,
      displayName: `${input.provider}:${input.externalThreadId}`,
    });

    await this.chatChannelRoutes.upsertActiveSession({
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
      activeChatSessionId: created.id,
    });

    return created;
  }

  async resolveOrCreatePreferredChannelSession(
    input: ChannelSessionResolveInput,
  ): Promise<ChatSessionSummaryDto> {
    const activeSessionId = await this.chatChannelRoutes.findActiveSessionId({
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
    });

    if (activeSessionId) {
      const activeSession = await this.chatSessions.findById(activeSessionId);
      if (activeSession) {
        await this.chatChannelRoutes.upsertActiveSession({
          provider: input.provider,
          externalThreadId: input.externalThreadId,
          externalUserId: input.externalUserId,
          activeChatSessionId: activeSession.id,
        });

        return this.mapSessionSummary(activeSession);
      }

      this.logger.warn(
        `Channel route pointed to missing chat session ${activeSessionId}; falling back to deterministic resolution`,
      );
    }

    const resolved = await this.resolveOrCreateChannelSession(input);

    await this.chatChannelRoutes.upsertActiveSession({
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
      activeChatSessionId: resolved.id,
    });

    return resolved;
  }

  async activateChannelSession(
    input: SetActiveChannelSessionInput,
  ): Promise<ChatSessionSummaryDto> {
    const session = await this.requireSession(input.chatSessionId);

    await this.chatChannelRoutes.upsertActiveSession({
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
      activeChatSessionId: session.id,
    });

    return this.mapSessionSummary(session);
  }

  async getActiveChannelSession(
    input: ChannelSessionIdentityInput,
  ): Promise<ChatSessionSummaryDto | null> {
    const activeSessionId = await this.chatChannelRoutes.findActiveSessionId({
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
    });
    if (!activeSessionId) {
      return null;
    }

    const session = await this.chatSessions.findById(activeSessionId);
    if (!session) {
      return null;
    }

    return this.mapSessionSummary(session);
  }

  async listRecentChannelSessions(
    input: ListRecentChannelSessionsInput,
  ): Promise<ChatSessionSummaryDto[]> {
    const activeSessionId = await this.chatChannelRoutes.findActiveSessionId({
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
    });
    const sessionIds =
      await this.chatMessages.findRecentSessionIdsByChannelIdentity({
        channel: input.provider,
        provider: input.provider,
        externalThreadId: input.externalThreadId,
        externalUserId: input.externalUserId,
        limit: input.limit,
      });

    const orderedIds = [
      ...(activeSessionId ? [activeSessionId] : []),
      ...sessionIds,
    ].filter(
      (sessionId, index, entries) => entries.indexOf(sessionId) === index,
    );

    if (orderedIds.length === 0) {
      return [];
    }

    const sessions = await this.chatSessions.findByIds(orderedIds);
    const sessionsById = new Map(
      sessions.map((session) => [session.id, session]),
    );
    const orderedSessions = orderedIds
      .map((sessionId) => sessionsById.get(sessionId) ?? null)
      .filter(
        (session): session is NonNullable<typeof session> => session !== null,
      )
      .slice(0, input.limit);

    return Promise.all(
      orderedSessions.map((session) => this.mapSessionSummary(session)),
    );
  }

  async canAccessChannelSession(input: {
    provider: string;
    externalThreadId: string;
    externalUserId: string;
    chatSessionId: string;
  }): Promise<boolean> {
    const activeSessionId = await this.chatChannelRoutes.findActiveSessionId({
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
    });
    if (activeSessionId === input.chatSessionId) {
      return true;
    }

    return this.chatMessages.hasChannelIdentityForSession({
      chatSessionId: input.chatSessionId,
      channel: input.provider,
      provider: input.provider,
      externalThreadId: input.externalThreadId,
      externalUserId: input.externalUserId,
    });
  }

  async resolveOrCreateChannelSession(
    input: ChannelSessionResolveInput,
  ): Promise<ChatSessionSummaryDto> {
    const deterministicId = buildDeterministicSessionId(
      `${input.provider}:${input.externalThreadId}:${input.externalUserId}`,
    );

    const existing = await this.chatSessions.findById(deterministicId);
    if (existing) {
      return this.mapSessionSummary(existing);
    }

    const profile = await this.requireActiveProfile(
      input.defaultAgentProfileName,
    );
    await this.assertProjectExists(input.scopeId ?? null);

    try {
      const created = await this.chatSessions.create(
        buildChatSessionCreatePayload({
          profile,
          status: ChatSessionStatus.RUNNING,
          executionState: 'running',
          source: ChatSessionSource.AD_HOC,
          initialMessage: input.initialMessage,
          displayName: `${input.provider}:${input.externalThreadId}`,
          scopeId: input.scopeId ?? null,
          overrides: { id: deterministicId },
        }),
      );
      return await this.mapSessionSummary(created);
    } catch {
      const raced = await this.chatSessions.findById(deterministicId);
      if (!raced) {
        throw new ConflictException(
          `Unable to create channel session for ${input.provider}:${input.externalThreadId}`,
        );
      }

      return await this.mapSessionSummary(raced);
    }
  }

  async listSessions(filters: ListChatSessionFilters): Promise<{
    data: ChatSessionSummaryDto[];
    meta: { pagination: { total: number; limit: number; offset: number } };
  }> {
    const [sessions, total] = await Promise.all([
      this.chatSessions.findAll(filters),
      this.chatSessions.count(filters),
    ]);

    const data = await Promise.all(
      sessions.map((session) => this.mapSessionSummary(session)),
    );

    return {
      data,
      meta: {
        pagination: {
          total,
          limit: filters.limit,
          offset: filters.offset,
        },
      },
    };
  }

  async getSession(chatId: string): Promise<ChatSessionDetailsDto> {
    const session = await this.requireSession(chatId);
    const [summary, timeline, latestBudgetDecision] = await Promise.all([
      this.mapSessionSummary(session),
      this.mapTimeline(chatId),
      this.budgetDecisionService.getLatestDecision('chat_session', chatId),
    ]);

    return {
      ...summary,
      model: session.model ?? null,
      provider: session.provider ?? null,
      containerTier: session.container_tier,
      errorMessage: session.error_message ?? null,
      messageTimeline: timeline,
      latestBudgetDecision,
    };
  }

  async retrySession(chatId: string): Promise<ChatSessionSummaryDto> {
    const session = await this.requireSession(chatId);

    if (
      session.status === ChatSessionStatus.RUNNING &&
      session.execution_state === 'running'
    ) {
      throw new ConflictException(
        `Chat session '${chatId}' is already actively running`,
      );
    }

    if (
      session.status !== ChatSessionStatus.FAILED &&
      !(
        session.status === ChatSessionStatus.RUNNING &&
        session.execution_state === 'retry_scheduled'
      )
    ) {
      throw new ConflictException(
        `Chat session '${chatId}' cannot be retried from ${session.status}/${session.execution_state}`,
      );
    }

    const updated = await this.chatSessions.update(chatId, {
      status: ChatSessionStatus.STARTING,
      execution_state: 'starting',
      retry_metadata: null,
      completed_at: null,
      error_message: null,
    });
    const retryGeneration = Date.now();

    try {
      await this.chatQueue.add(
        `chat-session:${session.id}`,
        {
          chatSessionId: session.id,
          agentProfileName: session.agent_profile_name,
          agentProfileId: session.agent_profile_id,
          contextId: session.scopeId ?? null,
          contextType: session.scopeId ? 'project' : null,
          initialMessage: session.initial_message,
          containerTier:
            session.container_tier ?? ChatSessionsService.LIGHT_TIER,
          retryGeneration,
        },
        {
          jobId: this.buildManualRetryJobId(session.id),
          removeOnComplete: 100,
          removeOnFail: 50,
        },
      );
    } catch (error) {
      await this.chatSessions.update(chatId, {
        status: session.status,
        execution_state: session.execution_state,
        retry_metadata: session.retry_metadata ?? null,
        completed_at: session.completed_at ?? null,
        error_message: session.error_message ?? null,
      });
      throw error;
    }

    await this.removeDelayedRetryJob(session.retry_metadata);

    return this.mapSessionSummary(updated ?? session);
  }

  private buildManualRetryJobId(chatId: string): string {
    return `chat-session-manual-retry:${chatId}:${Date.now().toString()}`;
  }

  async cancelSession(chatId: string): Promise<void> {
    const session = await this.requireSession(chatId);

    await this.chatSessions.update(chatId, {
      status: ChatSessionStatus.CANCELLED,
      execution_state: 'cancelled',
      completed_at: new Date(),
    });

    try {
      await this.memoryLifecycle.handleSessionClosed({
        chatSessionId: chatId,
        profileId: session.agent_profile_id,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue memory distillation for chat ${chatId}: ${(error as Error).message}`,
      );
    }
  }

  private async removeDelayedRetryJob(retryMetadata: unknown): Promise<void> {
    const retryJobId = this.getRetryJobId(retryMetadata);
    if (!retryJobId) {
      return;
    }

    try {
      const job = await this.chatQueue.getJob(retryJobId);
      await job?.remove?.();
    } catch (error) {
      this.logger.warn(
        `Failed to remove delayed retry job ${retryJobId}: ${(error as Error).message}`,
      );
    }
  }

  private getRetryJobId(retryMetadata: unknown): string | null {
    if (!retryMetadata || typeof retryMetadata !== 'object') {
      return null;
    }

    const retryJobId = (retryMetadata as { retryJobId?: unknown }).retryJobId;
    return typeof retryJobId === 'string' && retryJobId.length > 0
      ? retryJobId
      : null;
  }

  private async requireActiveProfile(profileName: string) {
    const profile =
      await this.coreLookups.findActiveAgentProfileByName(profileName);
    if (!profile) {
      throw new NotFoundException(
        `Agent profile '${profileName}' not found or inactive`,
      );
    }

    return profile;
  }

  private async assertProjectExists(scopeId: string | null): Promise<void> {
    if (!scopeId) {
      return;
    }

    const project = await this.coreLookups.findProjectById(scopeId);
    if (!project) {
      throw new NotFoundException(`Project '${scopeId}' not found`);
    }
  }

  private async requireSession(chatId: string) {
    const session = await this.chatSessions.findById(chatId);
    if (!session) {
      throw new NotFoundException(`Chat session '${chatId}' not found`);
    }

    return session;
  }

  async listChildSessions(parentId: string): Promise<ChatSessionSummaryDto[]> {
    const children =
      await this.chatSessions.findByParentChatSessionId(parentId);
    return Promise.all(
      children.map((session) => this.mapSessionSummary(session)),
    );
  }

  private async mapSessionSummary(session: {
    id: string;
    status: string;
    execution_state: ChatSessionSummaryDto['executionState'];
    retry_metadata?: ChatSessionSummaryDto['retryMetadata'];
    failure_info?: ChatSessionSummaryDto['failureInfo'];
    session_type: ChatSessionSummaryDto['sessionType'];
    agent_profile_name: string;
    scopeId?: string | null;
    display_name?: string | null;
    initial_message: string;
    created_at: Date;
    completed_at?: Date | null;
  }): Promise<ChatSessionSummaryDto> {
    return mapSessionSummaryDto(session, async (scopeId) => {
      const project = await this.coreLookups.findProjectById(scopeId);
      return project?.name ?? null;
    });
  }

  private async mapTimeline(
    chatId: string,
  ): Promise<ChatMessageTimelineItem[]> {
    const messages = await this.chatMessages.findBySessionId(chatId);
    return mapTimelineItems(messages);
  }

  private async enqueueChatSessionJob(
    session: {
      id: string;
      agent_profile_name: string;
      agent_profile_id: string;
      scopeId?: string | null;
      initial_message: string;
    },
    profile: { tier_preference: string | null },
  ): Promise<void> {
    const jobData = buildChatSessionJobData({
      session,
      tierPreference: profile.tier_preference,
      lightTier: ChatSessionsService.LIGHT_TIER,
      heavyTier: ChatSessionsService.HEAVY_TIER,
    });

    await this.chatQueue.add(`chat-session:${session.id}`, jobData, {
      jobId: session.id,
      removeOnComplete: 100,
      removeOnFail: 50,
    });

    this.logger.log(`Enqueued chat session job for ${session.id}`);
  }
}
