import { Test, TestingModule } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSessionCollaborationController } from './chat-session-collaboration.controller';
import { ChatSessionCollaborationService } from './chat-session-collaboration.service';

const chatCollaborationMock = {
  listParticipants: vi.fn(),
  inviteParticipant: vi.fn(),
  getSessionState: vi.fn(),
};

let controller: ChatSessionCollaborationController;

async function setupTestModule() {
  vi.clearAllMocks();

  const module: TestingModule = await Test.createTestingModule({
    controllers: [ChatSessionCollaborationController],
    providers: [
      {
        provide: ChatSessionCollaborationService,
        useValue: chatCollaborationMock,
      },
    ],
  }).compile();

  controller = module.get(ChatSessionCollaborationController);
}

describe('ChatSessionCollaborationController', () => {
  beforeEach(async () => {
    await setupTestModule();
  });

  it('lists chat session participants', async () => {
    chatCollaborationMock.listParticipants.mockResolvedValue([
      {
        id: 'participant-1',
        agent_profile: 'qa-agent',
        role: 'participant',
        participation_status: 'active',
        invited_by: 'ui:user-1',
        joined_at: new Date('2026-04-12T10:00:00.000Z'),
        left_at: null,
        created_at: new Date('2026-04-12T10:00:00.000Z'),
        updated_at: new Date('2026-04-12T10:00:00.000Z'),
      },
    ]);

    const result = await controller.listChatSessionParticipants('chat-1');

    expect(chatCollaborationMock.listParticipants).toHaveBeenCalledWith(
      'chat-1',
    );
    expect(result).toEqual({
      success: true,
      data: [
        {
          id: 'participant-1',
          agentProfile: 'qa-agent',
          role: 'participant',
          participationStatus: 'active',
          invitedBy: 'ui:user-1',
          joinedAt: new Date('2026-04-12T10:00:00.000Z'),
          leftAt: null,
          createdAt: new Date('2026-04-12T10:00:00.000Z'),
          updatedAt: new Date('2026-04-12T10:00:00.000Z'),
        },
      ],
    });
  });

  it('invites a participant into chat session', async () => {
    chatCollaborationMock.inviteParticipant.mockResolvedValue({
      status: 'accepted',
      chat_session_id: 'chat-1',
      participant: {
        id: 'participant-2',
        agent_profile: 'architect-agent',
        role: 'participant',
        participation_status: 'active',
        invited_by: 'ui:user-1',
        joined_at: '2026-04-12T10:00:00.000Z',
        left_at: null,
        created_at: '2026-04-12T10:00:00.000Z',
        updated_at: '2026-04-12T10:00:00.000Z',
      },
      lifecycle_events: [],
    });

    await expect(
      controller.inviteChatSessionParticipant(
        { user: { userId: 'user-1' } },
        'chat-1',
        {
          agent_profile: 'architect-agent',
          role: 'participant',
        },
      ),
    ).resolves.toMatchObject({
      success: true,
      data: { status: 'accepted' },
    });

    expect(chatCollaborationMock.inviteParticipant).toHaveBeenCalledWith({
      chatSessionId: 'chat-1',
      targetAgentProfile: 'architect-agent',
      role: 'participant',
      invitedBy: 'ui:user-1',
      metadata: null,
    });
  });

  it('returns chat collaboration state', async () => {
    chatCollaborationMock.getSessionState.mockResolvedValue({
      status: 'found',
      chat_session_id: 'chat-1',
      scope_id: 'project-1',
      session_status: 'RUNNING',
      participant_count: 2,
      active_participant_count: 2,
      invited_participant_count: 0,
      participants: [],
    });

    await expect(
      controller.getChatSessionState('chat-1'),
    ).resolves.toMatchObject({
      success: true,
      data: {
        status: 'found',
        chatSessionId: 'chat-1',
        participantCount: 2,
      },
    });
  });
});
