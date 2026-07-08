import { ConflictException } from '@nestjs/common';
import { ChatSessionStatus } from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import { ChatSessionsService } from './chat-sessions.service';

describe('ChatSessionsService', () => {
  it('enqueues job when creating a session', async () => {
    const chatSessions = {
      create: vi.fn().mockResolvedValue({
        id: 'chat-1',
        status: 'STARTING',
        execution_state: 'starting',
        retry_metadata: null,
        failure_info: null,
        session_type: 'general',
        agent_profile_id: 'profile-1',
        agent_profile_name: 'owner-agent',
        scopeId: 'project-1',
        display_name: 'Team Chat',
        initial_message: 'Kickoff',
        created_at: new Date('2026-04-14T10:00:00.000Z'),
        completed_at: null,
      }),
      findById: vi.fn(),
      update: vi.fn(),
    };
    const coreLookups = {
      findActiveAgentProfileByName: vi.fn().mockResolvedValue({
        id: 'profile-1',
        name: 'owner-agent',
        tier_preference: 'standard',
      }),
      findProjectById: vi.fn().mockResolvedValue({
        id: 'project-1',
        name: 'Project One',
      }),
    };
    const chatChannelRoutes = {
      findActiveSessionId: vi.fn(),
      upsertActiveSession: vi.fn(),
    };
    const chatCollaboration = {
      initializeSessionParticipants: vi.fn().mockResolvedValue(undefined),
      inviteParticipant: vi.fn().mockResolvedValue({ status: 'accepted' }),
    };
    const chatQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const service = new ChatSessionsService(
      chatSessions as never,
      chatChannelRoutes as never,
      {
        findBySessionId: vi.fn(),
        findRecentSessionIdsByChannelIdentity: vi.fn(),
        hasChannelIdentityForSession: vi.fn(),
      } as never,
      coreLookups as never,
      {
        handleSessionClosed: vi.fn(),
      } as never,
      chatCollaboration as never,
      chatQueue,
      { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
    );

    const created = await service.createSession({
      agentProfileName: 'owner-agent',
      scopeId: 'project-1',
      initialMessage: 'Kickoff',
      displayName: 'Team Chat',
      participants: [],
    });

    expect(chatSessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'STARTING',
        execution_state: 'starting',
        session_type: 'general',
      }),
    );
    expect(created).toEqual(
      expect.objectContaining({
        executionState: 'starting',
        retryMetadata: null,
        failureInfo: null,
      }),
    );
    expect(chatQueue.add).toHaveBeenCalledWith(
      'chat-session:chat-1',
      expect.objectContaining({
        chatSessionId: 'chat-1',
        agentProfileName: 'owner-agent',
        agentProfileId: 'profile-1',
        contextId: 'project-1',
        contextType: 'project',
        initialMessage: 'Kickoff',
        containerTier: 1,
      }),
      expect.objectContaining({
        jobId: 'chat-1',
        removeOnComplete: 100,
        removeOnFail: 50,
      }),
    );
  });

  it('enqueues heavy container tier for heavy profiles', async () => {
    const chatSessions = {
      create: vi.fn().mockResolvedValue({
        id: 'chat-heavy',
        status: 'STARTING',
        session_type: 'general',
        agent_profile_id: 'profile-heavy',
        agent_profile_name: 'spec-generator',
        scopeId: 'project-1',
        display_name: 'Spec Session',
        initial_message: 'Generate a spec',
        created_at: new Date('2026-04-14T10:00:00.000Z'),
        completed_at: null,
      }),
      findById: vi.fn(),
      update: vi.fn(),
    };
    const coreLookups = {
      findActiveAgentProfileByName: vi.fn().mockResolvedValue({
        id: 'profile-heavy',
        name: 'spec-generator',
        tier_preference: 'heavy',
      }),
      findProjectById: vi.fn().mockResolvedValue({
        id: 'project-1',
        name: 'Project One',
      }),
    };
    const chatChannelRoutes = {
      findActiveSessionId: vi.fn(),
      upsertActiveSession: vi.fn(),
    };
    const chatCollaboration = {
      initializeSessionParticipants: vi.fn().mockResolvedValue(undefined),
      inviteParticipant: vi.fn().mockResolvedValue({ status: 'accepted' }),
    };
    const chatQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const service = new ChatSessionsService(
      chatSessions as never,
      chatChannelRoutes as never,
      {
        findBySessionId: vi.fn(),
        findRecentSessionIdsByChannelIdentity: vi.fn(),
        hasChannelIdentityForSession: vi.fn(),
      } as never,
      coreLookups as never,
      {
        handleSessionClosed: vi.fn(),
      } as never,
      chatCollaboration as never,
      chatQueue,
      { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
    );

    await service.createSession({
      agentProfileName: 'spec-generator',
      scopeId: 'project-1',
      initialMessage: 'Generate a spec',
      displayName: 'Spec Session',
      participants: [],
    });

    expect(chatQueue.add).toHaveBeenCalledWith(
      'chat-session:chat-heavy',
      expect.objectContaining({
        chatSessionId: 'chat-heavy',
        agentProfileName: 'spec-generator',
        containerTier: 2,
      }),
      expect.any(Object),
    );
  });

  it('initializes collaboration participants when creating a session', async () => {
    const chatSessions = {
      create: vi.fn().mockResolvedValue({
        id: 'chat-1',
        status: 'STARTING',
        session_type: 'general',
        agent_profile_id: 'profile-1',
        agent_profile_name: 'owner-agent',
        scopeId: 'project-1',
        display_name: 'Team Chat',
        initial_message: 'Kickoff',
        created_at: new Date('2026-04-14T10:00:00.000Z'),
        completed_at: null,
      }),
      findById: vi.fn(),
      update: vi.fn(),
    };
    const coreLookups = {
      findActiveAgentProfileByName: vi
        .fn()
        .mockImplementation((profileName: string) => {
          if (
            profileName === 'owner-agent' ||
            profileName === 'participant-agent' ||
            profileName === 'moderator-agent'
          ) {
            return Promise.resolve({
              id: profileName,
              name: profileName,
              tier_preference: 'standard',
            });
          }

          return Promise.resolve(null);
        }),
      findProjectById: vi.fn().mockResolvedValue({
        id: 'project-1',
        name: 'Project One',
      }),
    };
    const chatChannelRoutes = {
      findActiveSessionId: vi.fn(),
      upsertActiveSession: vi.fn(),
    };
    const chatCollaboration = {
      initializeSessionParticipants: vi.fn().mockResolvedValue(undefined),
      inviteParticipant: vi.fn().mockResolvedValue({ status: 'accepted' }),
    };
    const chatQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const service = new ChatSessionsService(
      chatSessions as never,
      chatChannelRoutes as never,
      {
        findBySessionId: vi.fn(),
        findRecentSessionIdsByChannelIdentity: vi.fn(),
        hasChannelIdentityForSession: vi.fn(),
      } as never,
      coreLookups as never,
      {
        handleSessionClosed: vi.fn(),
      } as never,
      chatCollaboration as never,
      chatQueue,
      { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
    );

    const result = await service.createSession({
      agentProfileName: 'owner-agent',
      scopeId: 'project-1',
      initialMessage: 'Kickoff',
      displayName: 'Team Chat',
      participants: [
        { agent_profile: 'participant-agent' },
        { agent_profile: 'owner-agent' },
        { agent_profile: 'participant-agent' },
      ],
      moderatorProfile: 'moderator-agent',
      invitedBy: 'ui:user-1',
    });

    expect(result.id).toBe('chat-1');
    expect(chatSessions.create).toHaveBeenCalled();
    expect(
      chatCollaboration.initializeSessionParticipants,
    ).toHaveBeenCalledWith({
      chatSessionId: 'chat-1',
      primaryAgentProfile: 'owner-agent',
      participantProfiles: [],
      moderatorProfile: null,
      invitedBy: 'ui:user-1',
    });
    expect(chatCollaboration.inviteParticipant).toHaveBeenCalledTimes(2);
    expect(chatCollaboration.inviteParticipant).toHaveBeenNthCalledWith(1, {
      chatSessionId: 'chat-1',
      targetAgentProfile: 'participant-agent',
      role: 'participant',
      invitedBy: 'ui:user-1',
      metadata: { source: 'session_create' },
    });
    expect(chatCollaboration.inviteParticipant).toHaveBeenNthCalledWith(2, {
      chatSessionId: 'chat-1',
      targetAgentProfile: 'moderator-agent',
      role: 'moderator',
      invitedBy: 'ui:user-1',
      metadata: { source: 'session_create' },
    });
  });

  it('queues memory distillation when cancelling a session', async () => {
    const chatSessions = {
      findById: vi.fn().mockResolvedValue({
        id: 'chat-1',
        agent_profile_id: 'profile-1',
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    const chatChannelRoutes = {
      findActiveSessionId: vi.fn(),
      upsertActiveSession: vi.fn(),
    };
    const memoryLifecycle = {
      handleSessionClosed: vi.fn().mockResolvedValue(undefined),
    };
    const chatQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const service = new ChatSessionsService(
      chatSessions as never,
      chatChannelRoutes as never,
      {
        findBySessionId: vi.fn(),
        findRecentSessionIdsByChannelIdentity: vi.fn(),
        hasChannelIdentityForSession: vi.fn(),
      } as never,
      {
        findActiveAgentProfileByName: vi.fn(),
        findProjectById: vi.fn(),
      } as never,
      memoryLifecycle as never,
      {
        initializeSessionParticipants: vi.fn(),
      } as never,
      chatQueue,
      { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
    );

    await service.cancelSession('chat-1');

    expect(chatSessions.update).toHaveBeenCalledWith(
      'chat-1',
      expect.objectContaining({ status: 'CANCELLED' }),
    );
    expect(memoryLifecycle.handleSessionClosed).toHaveBeenCalledWith({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
    });
  });

  it('prefers active channel route when resolving preferred channel session', async () => {
    const chatSessions = {
      findById: vi.fn().mockResolvedValue({
        id: 'chat-active',
        status: 'RUNNING',
        session_type: 'general',
        agent_profile_name: 'ceo-agent',
        scope_id: null,
        display_name: 'telegram:77',
        initial_message: 'hello',
        created_at: new Date('2026-04-14T10:00:00.000Z'),
        completed_at: null,
      }),
      create: vi.fn(),
      update: vi.fn(),
      findByIds: vi.fn(),
    };
    const chatChannelRoutes = {
      findActiveSessionId: vi.fn().mockResolvedValue('chat-active'),
      upsertActiveSession: vi.fn().mockResolvedValue(undefined),
    };
    const chatQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const service = new ChatSessionsService(
      chatSessions as never,
      chatChannelRoutes as never,
      {
        findBySessionId: vi.fn(),
        findRecentSessionIdsByChannelIdentity: vi.fn(),
        hasChannelIdentityForSession: vi.fn(),
      } as never,
      {
        findActiveAgentProfileByName: vi.fn(),
        findProjectById: vi.fn().mockResolvedValue(null),
      } as never,
      {
        handleSessionClosed: vi.fn(),
      } as never,
      {
        initializeSessionParticipants: vi.fn(),
        inviteParticipant: vi.fn(),
      } as never,
      chatQueue,
      { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
    );

    const resolved = await service.resolveOrCreatePreferredChannelSession({
      provider: 'telegram',
      externalThreadId: '77',
      externalUserId: '88',
      initialMessage: 'hello',
      defaultAgentProfileName: 'ceo-agent',
      scopeId: null,
    });

    expect(resolved.id).toBe('chat-active');
    expect(chatChannelRoutes.upsertActiveSession).toHaveBeenCalledWith({
      provider: 'telegram',
      externalThreadId: '77',
      externalUserId: '88',
      activeChatSessionId: 'chat-active',
    });
  });

  it('lists recent channel sessions with active route first', async () => {
    const chatSessions = {
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findByIds: vi.fn().mockResolvedValue([
        {
          id: 'chat-1',
          status: 'RUNNING',
          session_type: 'general',
          agent_profile_name: 'ceo-agent',
          scope_id: null,
          display_name: 'telegram:77',
          initial_message: 'hello',
          created_at: new Date('2026-04-14T10:00:00.000Z'),
          completed_at: null,
        },
        {
          id: 'chat-2',
          status: 'RUNNING',
          session_type: 'general',
          agent_profile_name: 'architect-agent',
          scope_id: null,
          display_name: 'telegram:77',
          initial_message: 'resume',
          created_at: new Date('2026-04-14T10:01:00.000Z'),
          completed_at: null,
        },
      ]),
    };
    const chatChannelRoutes = {
      findActiveSessionId: vi.fn().mockResolvedValue('chat-2'),
      upsertActiveSession: vi.fn(),
    };
    const chatQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const service = new ChatSessionsService(
      chatSessions as never,
      chatChannelRoutes as never,
      {
        findBySessionId: vi.fn(),
        findRecentSessionIdsByChannelIdentity: vi
          .fn()
          .mockResolvedValue(['chat-1', 'chat-2']),
        hasChannelIdentityForSession: vi.fn(),
      } as never,
      {
        findActiveAgentProfileByName: vi.fn(),
        findProjectById: vi.fn().mockResolvedValue(null),
      } as never,
      {
        handleSessionClosed: vi.fn(),
      } as never,
      {
        initializeSessionParticipants: vi.fn(),
        inviteParticipant: vi.fn(),
      } as never,
      chatQueue,
      { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
    );

    const sessions = await service.listRecentChannelSessions({
      provider: 'telegram',
      externalThreadId: '77',
      externalUserId: '88',
      limit: 5,
    });

    expect(sessions.map((session) => session.id)).toEqual(['chat-2', 'chat-1']);
  });

  it('retries FAILED sessions immediately while keeping failure info queryable', async () => {
    const failureInfo = {
      reasonCode: 'rate_limit_exceeded',
      message: 'Rate limit exceeded',
      occurredAt: '2026-04-14T10:02:00.000Z',
      retryable: true,
    };
    const failedSession = createRetryableSession({
      status: ChatSessionStatus.FAILED,
      execution_state: 'failed',
      failure_info: failureInfo,
      completed_at: new Date('2026-04-14T10:03:00.000Z'),
    });
    const updatedSession = {
      ...failedSession,
      status: ChatSessionStatus.STARTING,
      execution_state: 'starting',
      retry_metadata: null,
      failure_info: failureInfo,
      completed_at: null,
    };
    const { service, chatSessions, chatQueue } = createRetrySessionService({
      session: failedSession,
      updatedSession,
    });

    const result = await service.retrySession('chat-retry');

    expect(chatSessions.update).toHaveBeenCalledWith(
      'chat-retry',
      expect.objectContaining({
        status: ChatSessionStatus.STARTING,
        execution_state: 'starting',
        retry_metadata: null,
        completed_at: null,
      }),
    );
    expect(chatSessions.update.mock.calls[0]?.[1]).not.toHaveProperty(
      'failure_info',
    );
    expect(chatQueue.add).toHaveBeenCalledWith(
      'chat-session:chat-retry',
      expect.objectContaining({
        chatSessionId: 'chat-retry',
        agentProfileName: 'owner-agent',
        agentProfileId: 'profile-1',
        contextId: 'project-1',
        contextType: 'project',
        initialMessage: 'retry me',
        containerTier: 1,
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^chat-session-manual-retry:chat-retry:/),
        removeOnComplete: 100,
        removeOnFail: 50,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: 'chat-retry',
        executionState: 'starting',
        retryMetadata: null,
        failureInfo,
      }),
    );
  });

  it('retries RUNNING retry_scheduled sessions', async () => {
    const scheduledSession = createRetryableSession({
      status: ChatSessionStatus.RUNNING,
      execution_state: 'retry_scheduled',
      retry_metadata: {
        attempt: 1,
        maxAttempts: 3,
        nextRetryAt: '2026-04-14T10:10:00.000Z',
        reasonCode: 'rate_limit_exceeded',
        reasonMessage: 'Rate limit exceeded',
        retryJobId: 'chat-session-retry:chat-retry:1',
      },
    });
    const updatedSession = {
      ...scheduledSession,
      status: ChatSessionStatus.STARTING,
      execution_state: 'starting',
      retry_metadata: null,
    };
    const { service, chatSessions, chatQueue } = createRetrySessionService({
      session: scheduledSession,
      updatedSession,
    });

    const result = await service.retrySession('chat-retry');

    expect(chatSessions.update).toHaveBeenCalledWith(
      'chat-retry',
      expect.objectContaining({
        status: ChatSessionStatus.STARTING,
        execution_state: 'starting',
        retry_metadata: null,
      }),
    );
    expect(chatQueue.add).toHaveBeenCalledWith(
      'chat-session:chat-retry',
      expect.objectContaining({
        chatSessionId: 'chat-retry',
        retryGeneration: expect.any(Number),
      }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^chat-session-manual-retry:chat-retry:/),
      }),
    );
    expect(result.executionState).toBe('starting');
  });

  it('throws ConflictException for actively running sessions', async () => {
    const runningSession = createRetryableSession({
      status: ChatSessionStatus.RUNNING,
      execution_state: 'running',
    });
    const { service, chatSessions, chatQueue } = createRetrySessionService({
      session: runningSession,
    });

    await expect(service.retrySession('chat-retry')).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(chatSessions.update).not.toHaveBeenCalled();
    expect(chatQueue.add).not.toHaveBeenCalled();
  });

  it('removes the delayed retry job when retry metadata has retryJobId and the queue returns the job', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const scheduledSession = createRetryableSession({
      status: ChatSessionStatus.RUNNING,
      execution_state: 'retry_scheduled',
      retry_metadata: {
        attempt: 1,
        maxAttempts: 3,
        nextRetryAt: '2026-04-14T10:10:00.000Z',
        reasonCode: 'rate_limit_exceeded',
        reasonMessage: 'Rate limit exceeded',
        retryJobId: 'chat-session-retry:chat-retry:1',
      },
    });
    const updatedSession = {
      ...scheduledSession,
      status: ChatSessionStatus.STARTING,
      execution_state: 'starting',
      retry_metadata: null,
    };
    const { service, chatQueue } = createRetrySessionService({
      session: scheduledSession,
      updatedSession,
      delayedRetryJob: { remove },
    });

    await service.retrySession('chat-retry');

    expect(chatQueue.getJob).toHaveBeenCalledWith(
      'chat-session-retry:chat-retry:1',
    );
    expect(remove).toHaveBeenCalled();
  });

  it('uses a fresh immediate retry job id when a historical original job exists', async () => {
    const historicalJob = { remove: vi.fn().mockResolvedValue(undefined) };
    const failedSession = createRetryableSession({
      status: ChatSessionStatus.FAILED,
      execution_state: 'failed',
    });
    const updatedSession = {
      ...failedSession,
      status: ChatSessionStatus.STARTING,
      execution_state: 'starting',
      retry_metadata: null,
    };
    const { service, chatQueue } = createRetrySessionService({
      session: failedSession,
      updatedSession,
      jobsById: new Map([['chat-retry', historicalJob]]),
    });

    await service.retrySession('chat-retry');

    expect(chatQueue.getJob).not.toHaveBeenCalledWith('chat-retry');
    expect(historicalJob.remove).not.toHaveBeenCalled();
    expect(chatQueue.add).toHaveBeenCalledWith(
      'chat-session:chat-retry',
      expect.objectContaining({ chatSessionId: 'chat-retry' }),
      expect.objectContaining({
        jobId: expect.stringMatching(/^chat-session-manual-retry:chat-retry:/),
      }),
    );
  });

  it('restores retryable session state when immediate enqueue fails after update', async () => {
    const remove = vi.fn().mockResolvedValue(undefined);
    const retryMetadata = {
      attempt: 1,
      maxAttempts: 3,
      nextRetryAt: '2026-04-14T10:10:00.000Z',
      reasonCode: 'rate_limit_exceeded',
      reasonMessage: 'Rate limit exceeded',
      retryJobId: 'chat-session-retry:chat-retry:1',
    };
    const scheduledSession = createRetryableSession({
      status: ChatSessionStatus.RUNNING,
      execution_state: 'retry_scheduled',
      retry_metadata: retryMetadata,
      completed_at: null,
    });
    const { service, chatSessions, chatQueue } = createRetrySessionService({
      session: scheduledSession,
      delayedRetryJob: { remove },
      enqueueError: new Error('Queue unavailable'),
    });

    await expect(service.retrySession('chat-retry')).rejects.toThrow(
      'Queue unavailable',
    );

    expect(chatSessions.update).toHaveBeenNthCalledWith(
      1,
      'chat-retry',
      expect.objectContaining({
        status: ChatSessionStatus.STARTING,
        execution_state: 'starting',
        retry_metadata: null,
      }),
    );
    expect(chatSessions.update).toHaveBeenNthCalledWith(2, 'chat-retry', {
      status: ChatSessionStatus.RUNNING,
      execution_state: 'retry_scheduled',
      retry_metadata: retryMetadata,
      completed_at: null,
      error_message: null,
    });
    expect(chatQueue.add).toHaveBeenCalled();
    expect(chatQueue.getJob).not.toHaveBeenCalledWith(
      'chat-session-retry:chat-retry:1',
    );
    expect(remove).not.toHaveBeenCalled();
  });
  describe('getSession', () => {
    it('includes latestBudgetDecision from BudgetDecisionService in the returned DTO', async () => {
      const mockSession = {
        id: 'sess-1',
        status: 'COMPLETED',
        execution_state: 'complete',
        retry_metadata: null,
        failure_info: null,
        session_type: 'general',
        agent_profile_name: 'owner-agent',
        scopeId: null,
        source: 'ad-hoc',
        parent_chat_session_id: null,
        display_name: 'Test Session',
        initial_message: 'Hello',
        workflow_run_id: null,
        created_at: new Date('2025-01-01'),
        completed_at: null,
        model: 'claude-3',
        provider: 'anthropic',
        container_tier: 1,
        error_message: null,
      };

      const mockDecision = {
        decision: 'warn' as const,
        reasonCode: 'soft_limit_exceeded',
        estimatedCostCents: 150,
        remainingBudgetCents: 50,
      };

      const chatSessions = { findById: vi.fn().mockResolvedValue(mockSession) };
      const chatMessages = { findBySessionId: vi.fn().mockResolvedValue([]) };
      const coreLookups = {
        findProjectById: vi.fn().mockResolvedValue(null),
        findActiveAgentProfileByName: vi.fn(),
      };
      const budgetSvc = {
        getLatestDecision: vi.fn().mockResolvedValue(mockDecision),
      };

      const service = new ChatSessionsService(
        chatSessions as never,
        undefined as never,
        chatMessages as never,
        coreLookups as never,
        undefined as never,
        undefined as never,
        undefined,
        budgetSvc as never,
      );

      const result = await service.getSession('sess-1');

      expect(budgetSvc.getLatestDecision).toHaveBeenCalledWith(
        'chat_session',
        'sess-1',
      );
      expect(result.latestBudgetDecision).toEqual(mockDecision);
    });
  });
});

function createRetryableSession(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chat-retry',
    status: ChatSessionStatus.FAILED,
    execution_state: 'failed',
    retry_metadata: null,
    failure_info: null,
    session_type: 'general',
    agent_profile_id: 'profile-1',
    agent_profile_name: 'owner-agent',
    scopeId: 'project-1',
    display_name: 'Retry Session',
    initial_message: 'retry me',
    created_at: new Date('2026-04-14T10:00:00.000Z'),
    completed_at: null,
    ...overrides,
  };
}

function createRetrySessionService(input: {
  session: ReturnType<typeof createRetryableSession>;
  updatedSession?: ReturnType<typeof createRetryableSession>;
  delayedRetryJob?: { remove: ReturnType<typeof vi.fn> } | null;
  jobsById?: Map<string, { remove: ReturnType<typeof vi.fn> }>;
  enqueueError?: Error;
}) {
  const chatSessions = {
    findById: vi.fn().mockResolvedValue(input.session),
    update: vi.fn().mockResolvedValue(input.updatedSession ?? input.session),
  };
  const chatQueue = {
    add: input.enqueueError
      ? vi.fn().mockRejectedValue(input.enqueueError)
      : vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockImplementation((jobId: string) => {
      if (input.jobsById?.has(jobId)) {
        return Promise.resolve(input.jobsById.get(jobId));
      }

      return Promise.resolve(input.delayedRetryJob ?? null);
    }),
  };

  const service = new ChatSessionsService(
    chatSessions as never,
    {
      findActiveSessionId: vi.fn(),
      upsertActiveSession: vi.fn(),
    } as never,
    {
      findBySessionId: vi.fn(),
      findRecentSessionIdsByChannelIdentity: vi.fn(),
      hasChannelIdentityForSession: vi.fn(),
    } as never,
    {
      findActiveAgentProfileByName: vi.fn().mockResolvedValue({
        id: 'profile-1',
        name: 'owner-agent',
        tier_preference: 'standard',
      }),
      findProjectById: vi.fn().mockResolvedValue({
        id: 'project-1',
        name: 'Project One',
      }),
    } as never,
    {
      handleSessionClosed: vi.fn(),
    } as never,
    {
      initializeSessionParticipants: vi.fn(),
      inviteParticipant: vi.fn(),
    } as never,
    chatQueue,
    { getLatestDecision: vi.fn().mockResolvedValue(null) } as never,
  );

  return { service, chatSessions, chatQueue };
}
