import { describe, expect, it, vi } from 'vitest';
import { ChatMemoryLifecycleService } from './chat-memory-lifecycle.service';

describe('ChatMemoryLifecycleService', () => {
  it('records inbound memory and schedules distillation on configured turn window', async () => {
    const sessionMemory = {
      create: vi.fn().mockResolvedValue({ id: 'memory-1' }),
      pruneBySession: vi.fn().mockResolvedValue(0),
      countBySession: vi.fn().mockResolvedValue(6),
    };
    const jobs = {
      enqueueDistillation: vi.fn().mockResolvedValue(undefined),
    };
    const contextAssembler = {
      assembleContext: vi.fn(),
    };

    const service = new ChatMemoryLifecycleService(
      sessionMemory as never,
      jobs as never,
      contextAssembler as never,
    );

    await service.recordInboundMessage({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      sourceMessageId: 'msg-1',
      sourceRole: 'user',
      content: 'I prefer concise release updates.',
      channel: 'telegram',
      correlationId: 'corr-1',
      metadata: { locale: 'en' },
    });

    expect(sessionMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        chat_session_id: 'chat-1',
        profile_id: 'profile-1',
        source_message_id: 'msg-1',
        memory_type: 'preference',
      }),
    );
    expect(jobs.enqueueDistillation).toHaveBeenCalledWith({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      triggerReason: 'turn_count',
      idempotencyKey: 'distill:turn_count:chat-1:1',
    });
  });

  it('delegates action context assembly to the context service', async () => {
    const contextAssembler = {
      assembleContext: vi.fn().mockResolvedValue({
        retrieval: {
          retrievalId: 'ret-1',
          requestedAt: '2026-04-13T00:00:00.000Z',
          tokenBudget: 600,
          hitCount: 0,
          sessionHitCount: 0,
          profileHitCount: 0,
          consumedCharacters: 0,
        },
        slices: [],
      }),
    };

    const service = new ChatMemoryLifecycleService(
      {
        create: vi.fn(),
        pruneBySession: vi.fn(),
        countBySession: vi.fn(),
      } as never,
      {
        enqueueDistillation: vi.fn(),
      } as never,
      contextAssembler as never,
    );

    const result = await service.buildActionContext({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'status',
    });

    expect(contextAssembler.assembleContext).toHaveBeenCalledWith({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      prompt: 'status',
    });
    expect(result.slices).toEqual([]);
  });

  it('queues a session-close distillation job', async () => {
    const jobs = {
      enqueueDistillation: vi.fn().mockResolvedValue(undefined),
    };

    const service = new ChatMemoryLifecycleService(
      {
        create: vi.fn(),
        pruneBySession: vi.fn(),
        countBySession: vi.fn(),
      } as never,
      jobs as never,
      {
        assembleContext: vi.fn(),
      } as never,
    );

    await service.handleSessionClosed({
      chatSessionId: 'chat-2',
      profileId: 'profile-2',
    });

    expect(jobs.enqueueDistillation).toHaveBeenCalledWith({
      chatSessionId: 'chat-2',
      profileId: 'profile-2',
      triggerReason: 'session_close',
      idempotencyKey: 'distill:session_close:chat-2',
    });
  });
});
