import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ChatSessionCollaborationService } from './chat-session-collaboration.service';
import { ChatSessionParticipantRepository } from '../database/repositories/chat-session-participant.repository';
import { ChatSessionRepository } from '../database/repositories/chat-session.repository';
import { ChatCoreLookupService } from '../chat-actions/chat-core-lookup.service';

describe('ChatSessionCollaborationService', () => {
  let service: ChatSessionCollaborationService;
  let chatSessionRepo: {
    findById: ReturnType<typeof vi.fn>;
  };
  let chatParticipantRepo: {
    countByChatSessionId: ReturnType<typeof vi.fn>;
    countInvitesByChatSessionId: ReturnType<typeof vi.fn>;
    findByChatSessionAndAgentProfile: ReturnType<typeof vi.fn>;
    upsertByChatSessionAndAgentProfile: ReturnType<typeof vi.fn>;
  };
  let coreLookups: {
    findActiveAgentProfileByName: ReturnType<typeof vi.fn>;
  };
  let chatQueue: {
    add: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    chatSessionRepo = {
      findById: vi.fn(),
    };
    chatParticipantRepo = {
      countByChatSessionId: vi.fn().mockResolvedValue(2),
      countInvitesByChatSessionId: vi.fn().mockResolvedValue(1),
      findByChatSessionAndAgentProfile: vi.fn().mockResolvedValue(null),
      upsertByChatSessionAndAgentProfile: vi.fn(),
    };
    coreLookups = {
      findActiveAgentProfileByName: vi.fn(),
    };
    chatQueue = {
      add: vi.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        ChatSessionCollaborationService,
        { provide: ChatSessionRepository, useValue: chatSessionRepo },
        {
          provide: ChatSessionParticipantRepository,
          useValue: chatParticipantRepo,
        },
        { provide: ChatCoreLookupService, useValue: coreLookups },
        { provide: getQueueToken('chat-sessions'), useValue: chatQueue },
      ],
    }).compile();

    service = module.get(ChatSessionCollaborationService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('activates accepted invited participant by queueing execution', async () => {
    chatSessionRepo.findById.mockResolvedValue({
      id: 'chat-1',
      scopeId: '11111111-1111-1111-1111-111111111111',
      status: 'RUNNING',
    });
    coreLookups.findActiveAgentProfileByName
      .mockResolvedValueOnce({
        id: 'agent-2-id',
        name: 'architect-agent',
        tier_preference: 'heavy',
        isActive: true,
      })
      .mockResolvedValueOnce({
        id: 'agent-2-id',
        name: 'architect-agent',
        tier_preference: 'heavy',
        isActive: true,
      });

    chatParticipantRepo.upsertByChatSessionAndAgentProfile
      .mockResolvedValueOnce({
        id: 'participant-1',
        chat_session_id: 'chat-1',
        agent_profile: 'architect-agent',
        role: 'participant',
        participation_status: 'invited',
        invited_by: 'agent:ceo',
        joined_at: null,
        left_at: null,
        metadata: { reason: 'Need architecture review' },
        created_at: new Date('2026-04-19T10:00:00.000Z'),
        updated_at: new Date('2026-04-19T10:00:00.000Z'),
      })
      .mockResolvedValueOnce({
        id: 'participant-1',
        chat_session_id: 'chat-1',
        agent_profile: 'architect-agent',
        role: 'participant',
        participation_status: 'active',
        invited_by: 'agent:ceo',
        joined_at: new Date('2026-04-19T10:01:00.000Z'),
        left_at: null,
        metadata: { reason: 'Need architecture review' },
        created_at: new Date('2026-04-19T10:00:00.000Z'),
        updated_at: new Date('2026-04-19T10:01:00.000Z'),
      });

    const result = await service.inviteParticipant({
      chatSessionId: 'chat-1',
      targetAgentProfile: 'architect-agent',
      invitedBy: 'agent:ceo',
      metadata: { reason: 'Need architecture review' },
    });

    expect(result.status).toBe('accepted');
    expect(result.participant?.participation_status).toBe('active');
    expect(chatQueue.add).toHaveBeenCalledWith(
      expect.stringContaining('chat-session:chat-1:architect-agent:invite'),
      expect.objectContaining({
        chatSessionId: 'chat-1',
        agentProfileName: 'architect-agent',
        agentProfileId: 'agent-2-id',
        contextId: '11111111-1111-1111-1111-111111111111',
        containerTier: 2,
      }),
      {
        jobId: expect.stringContaining('chat-1-architect-agent-invite-'),
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    );
    expect(result.lifecycle_events.map((event) => event.event_type)).toEqual([
      'chat_participant_invited',
      'chat_participant_activated',
    ]);
  });

  it('returns denied result and does not enqueue when target agent profile is not active', async () => {
    chatSessionRepo.findById.mockResolvedValue({
      id: 'chat-2',
      scope_id: null,
      status: 'RUNNING',
    });
    coreLookups.findActiveAgentProfileByName.mockResolvedValue(null);

    const result = await service.inviteParticipant({
      chatSessionId: 'chat-2',
      targetAgentProfile: 'inactive-agent',
      invitedBy: 'agent:ceo',
    });

    expect(result.status).toBe('denied');
    expect(result.denial_reason).toBe('target_agent_profile_not_active');
    expect(chatQueue.add).not.toHaveBeenCalled();
  });
});
