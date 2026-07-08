import { describe, expect, it, vi } from 'vitest';
import { ChatMemoryDistillationService } from './chat-memory-distillation.service';

describe('ChatMemoryDistillationService', () => {
  it('promotes a new profile memory and emits chat.memory.promoted.v1', async () => {
    const sessionMemory = {
      findUndistilledBySession: vi.fn().mockResolvedValue([
        {
          id: 'session-memory-1',
          content: 'The user prefers concise executive summaries.',
          normalized_content: 'the user prefers concise executive summaries',
          memory_type: 'preference',
          importance_score: 88,
          provenance: { channel: 'telegram' },
        },
      ]),
      markDistilled: vi.fn().mockResolvedValue(undefined),
    };
    const profileMemory = {
      findByNormalized: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'profile-memory-1',
        confidence_score: 88,
      }),
      update: vi.fn(),
      findAllActiveByProfile: vi.fn(),
      archive: vi.fn(),
    };
    const promotionAudit = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'audit-1' }),
    };
    const eventPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = {
      recordPromotion: vi.fn(),
    };

    const service = new ChatMemoryDistillationService(
      sessionMemory as never,
      profileMemory as never,
      promotionAudit as never,
      eventPublisher as never,
      metrics as never,
    );

    await service.distillSessionMemory({
      chatSessionId: 'chat-1',
      profileId: 'profile-1',
      correlationId: 'corr-1',
      triggerReason: 'turn_count',
    });

    expect(profileMemory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        profile_id: 'profile-1',
        memory_type: 'preference',
      }),
    );
    expect(sessionMemory.markDistilled).toHaveBeenCalledWith(
      ['session-memory-1'],
      'profile-memory-1',
    );
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'chat.memory.promoted.v1',
        action: 'promoted',
      }),
    );
    expect(metrics.recordPromotion).toHaveBeenCalledTimes(1);
  });

  it('updates existing profile memory and emits chat.memory.updated.v1', async () => {
    const sessionMemory = {
      findUndistilledBySession: vi.fn().mockResolvedValue([
        {
          id: 'session-memory-2',
          content: 'Reminder: release demos should be two minutes.',
          normalized_content: 'reminder release demos should be two minutes',
          memory_type: 'fact',
          importance_score: 70,
          provenance: { channel: 'api' },
        },
      ]),
      markDistilled: vi.fn().mockResolvedValue(undefined),
    };
    const profileMemory = {
      findByNormalized: vi.fn().mockResolvedValue({
        id: 'profile-memory-2',
        content: 'Release demos should be concise.',
        confidence_score: 60,
        promotion_count: 2,
        provenance: null,
      }),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({ id: 'profile-memory-2' }),
      findAllActiveByProfile: vi.fn(),
      archive: vi.fn(),
    };
    const promotionAudit = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'audit-2' }),
    };
    const eventPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = {
      recordPromotion: vi.fn(),
    };

    const service = new ChatMemoryDistillationService(
      sessionMemory as never,
      profileMemory as never,
      promotionAudit as never,
      eventPublisher as never,
      metrics as never,
    );

    await service.distillSessionMemory({
      chatSessionId: 'chat-2',
      profileId: 'profile-2',
      correlationId: 'corr-2',
      triggerReason: 'turn_count',
    });

    expect(profileMemory.update).toHaveBeenCalledWith(
      'profile-memory-2',
      expect.objectContaining({
        promotion_count: 3,
      }),
    );
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'chat.memory.updated.v1',
        action: 'updated',
      }),
    );
    expect(metrics.recordPromotion).not.toHaveBeenCalled();
  });

  it('archives duplicate profile memories during consolidation', async () => {
    const sessionMemory = {
      findUndistilledBySession: vi.fn(),
      markDistilled: vi.fn(),
    };
    const profileMemory = {
      findByNormalized: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      findAllActiveByProfile: vi.fn().mockResolvedValue([
        {
          id: 'profile-memory-3',
          normalized_content: 'same memory',
          memory_type: 'fact',
          updated_at: new Date('2026-04-13T10:00:00.000Z'),
          last_chat_session_id: 'chat-3',
        },
        {
          id: 'profile-memory-4',
          normalized_content: 'same memory',
          memory_type: 'fact',
          updated_at: new Date('2026-04-13T09:00:00.000Z'),
          last_chat_session_id: 'chat-3',
        },
      ]),
      archive: vi.fn().mockResolvedValue(undefined),
    };
    const promotionAudit = {
      findByIdempotencyKey: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'audit-3' }),
    };
    const eventPublisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    };
    const metrics = {
      recordPromotion: vi.fn(),
    };

    const service = new ChatMemoryDistillationService(
      sessionMemory as never,
      profileMemory as never,
      promotionAudit as never,
      eventPublisher as never,
      metrics as never,
    );

    await service.consolidateProfileMemory({
      profileId: 'profile-3',
      correlationId: 'corr-3',
      triggerReason: 'distillation',
    });

    expect(profileMemory.archive).toHaveBeenCalledWith(['profile-memory-4']);
    expect(eventPublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'chat.memory.updated.v1',
        action: 'archived',
      }),
    );
  });
});
