import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ChatSessionLearningFlushListener } from './chat-session-learning-flush.listener';

describe('ChatSessionLearningFlushListener', () => {
  let listener: ChatSessionLearningFlushListener;
  let chatSessionRepo: any;
  let settings: any;
  let enqueueService: any;

  beforeEach(() => {
    chatSessionRepo = {
      findById: vi.fn(),
    };
    settings = {
      get: vi.fn(),
    };
    enqueueService = {
      enqueueChatSession: vi.fn(),
    };

    listener = new ChatSessionLearningFlushListener(
      chatSessionRepo,
      settings,
      enqueueService,
    );
  });

  it('exits early if the toggle is disabled', async () => {
    settings.get.mockResolvedValue(false);

    await listener.handleSessionCompleted({ sessionId: 'session-123' });

    expect(settings.get).toHaveBeenCalled();
    expect(chatSessionRepo.findById).not.toHaveBeenCalled();
  });

  it('enqueues the chat session when the toggle is enabled', async () => {
    settings.get.mockResolvedValue(true);
    const mockSession = {
      id: 'session-123',
      scopeId: 'scope-456',
      agent_profile_name: 'test-agent',
      workflow_run_id: 'run-789',
      status: 'completed',
    };
    chatSessionRepo.findById.mockResolvedValue(mockSession);

    await listener.handleSessionCompleted({ sessionId: 'session-123' });

    expect(chatSessionRepo.findById).toHaveBeenCalledWith('session-123');
    expect(enqueueService.enqueueChatSession).toHaveBeenCalledWith(mockSession);
  });
});
