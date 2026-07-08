import { Injectable } from '@nestjs/common';
import { ChatMemoryPromotionAuditRepository } from '../database/repositories/chat-memory-promotion-audit.repository';
import { ChatProfileMemoryRepository } from '../database/repositories/chat-profile-memory.repository';
import { ChatSessionMemoryRepository } from '../database/repositories/chat-session-memory.repository';
import { ChatMemoryEventPublisherService } from './chat-memory-event-publisher.service';
import { ChatMemoryMetricsService } from './chat-memory-metrics.service';

@Injectable()
export class ChatMemoryDistillationService {
  constructor(
    private readonly sessionMemory: ChatSessionMemoryRepository,
    private readonly profileMemory: ChatProfileMemoryRepository,
    private readonly promotionAudit: ChatMemoryPromotionAuditRepository,
    private readonly eventPublisher: ChatMemoryEventPublisherService,
    private readonly metrics: ChatMemoryMetricsService,
  ) {}

  async distillSessionMemory(params: {
    chatSessionId: string;
    profileId: string;
    correlationId: string;
    triggerReason: string;
  }): Promise<void> {
    const candidates = await this.sessionMemory.findUndistilledBySession(
      params.chatSessionId,
      80,
    );

    for (const candidate of candidates) {
      await this.promoteCandidate({
        candidate,
        profileId: params.profileId,
        chatSessionId: params.chatSessionId,
        correlationId: params.correlationId,
        triggerReason: params.triggerReason,
      });
    }
  }

  async consolidateProfileMemory(params: {
    profileId: string;
    correlationId: string;
    triggerReason: string;
  }): Promise<void> {
    const memories = await this.profileMemory.findAllActiveByProfile(
      params.profileId,
    );
    const groups = groupByNormalization(memories);

    for (const group of groups.values()) {
      if (group.length <= 1) {
        continue;
      }

      const sorted = [...group].sort(
        (left, right) => right.updated_at.getTime() - left.updated_at.getTime(),
      );
      const canonical = sorted[0];
      const stale = sorted.slice(1);

      await this.profileMemory.archive(stale.map((memory) => memory.id));

      for (const archived of stale) {
        await this.publishArchiveEvent({
          archivedMemoryId: archived.id,
          chatSessionId: canonical.last_chat_session_id,
          profileId: params.profileId,
          correlationId: params.correlationId,
          triggerReason: params.triggerReason,
          idempotencyKey: `archive:${params.profileId}:${archived.id}`,
        });
      }
    }
  }

  private async promoteCandidate(params: {
    candidate: {
      id: string;
      content: string;
      normalized_content: string;
      memory_type: 'preference' | 'fact' | 'history';
      importance_score: number;
      provenance?: Record<string, unknown> | null;
    };
    profileId: string;
    chatSessionId: string;
    correlationId: string;
    triggerReason: string;
  }): Promise<void> {
    const content = params.candidate.content.trim();
    if (content.length < 8) {
      await this.sessionMemory.markDistilled([params.candidate.id], null);
      return;
    }

    const idempotencyKey =
      `promote:${params.profileId}:` +
      `${params.chatSessionId}:${params.candidate.id}:${params.triggerReason}`;

    const existingAudit =
      await this.promotionAudit.findByIdempotencyKey(idempotencyKey);
    if (existingAudit) {
      await this.sessionMemory.markDistilled(
        [params.candidate.id],
        existingAudit.profile_memory_id,
      );
      return;
    }

    const existingMemory = await this.profileMemory.findByNormalized({
      profileId: params.profileId,
      normalizedContent: params.candidate.normalized_content,
      memoryType: params.candidate.memory_type,
    });

    if (existingMemory) {
      await this.updateExistingProfileMemory({
        existingMemory,
        candidate: params.candidate,
        profileId: params.profileId,
        chatSessionId: params.chatSessionId,
        correlationId: params.correlationId,
        triggerReason: params.triggerReason,
        idempotencyKey,
      });
      return;
    }

    await this.createProfileMemory({
      candidate: params.candidate,
      profileId: params.profileId,
      chatSessionId: params.chatSessionId,
      correlationId: params.correlationId,
      triggerReason: params.triggerReason,
      idempotencyKey,
    });
  }

  private async createProfileMemory(params: {
    candidate: {
      id: string;
      content: string;
      normalized_content: string;
      memory_type: 'preference' | 'fact' | 'history';
      importance_score: number;
      provenance?: Record<string, unknown> | null;
    };
    profileId: string;
    chatSessionId: string;
    correlationId: string;
    triggerReason: string;
    idempotencyKey: string;
  }): Promise<void> {
    const now = new Date();
    const created = await this.profileMemory.create({
      profile_id: params.profileId,
      last_chat_session_id: params.chatSessionId,
      memory_type: params.candidate.memory_type,
      content: params.candidate.content,
      normalized_content: params.candidate.normalized_content,
      confidence_score: clampScore(params.candidate.importance_score),
      promotion_count: 1,
      last_promoted_at: now,
      provenance: params.candidate.provenance ?? null,
    });

    await this.promotionAudit.create({
      chat_session_id: params.chatSessionId,
      profile_id: params.profileId,
      session_memory_id: params.candidate.id,
      profile_memory_id: created.id,
      action: 'promoted',
      idempotency_key: params.idempotencyKey,
      trigger_reason: params.triggerReason,
      metadata: {
        confidenceScore: created.confidence_score,
      },
    });

    await this.sessionMemory.markDistilled([params.candidate.id], created.id);
    await this.eventPublisher.publish({
      eventType: 'chat.memory.promoted.v1',
      correlationId: params.correlationId,
      chatSessionId: params.chatSessionId,
      memoryId: created.id,
      action: 'promoted',
      profileId: params.profileId,
      metadata: {
        triggerReason: params.triggerReason,
      },
    });

    this.metrics.recordPromotion();
  }

  private async updateExistingProfileMemory(params: {
    existingMemory: {
      id: string;
      content: string;
      confidence_score: number;
      promotion_count: number;
      provenance?: Record<string, unknown> | null;
    };
    candidate: {
      id: string;
      content: string;
      importance_score: number;
      provenance?: Record<string, unknown> | null;
    };
    profileId: string;
    chatSessionId: string;
    correlationId: string;
    triggerReason: string;
    idempotencyKey: string;
  }): Promise<void> {
    const mergedContent =
      params.candidate.content.length > params.existingMemory.content.length
        ? params.candidate.content
        : params.existingMemory.content;

    await this.profileMemory.update(params.existingMemory.id, {
      content: mergedContent,
      confidence_score: clampScore(
        params.existingMemory.confidence_score +
          Math.ceil(params.candidate.importance_score / 4),
      ),
      promotion_count: params.existingMemory.promotion_count + 1,
      last_promoted_at: new Date(),
      last_chat_session_id: params.chatSessionId,
      provenance: {
        ...params.existingMemory.provenance,
        ...params.candidate.provenance,
      },
    });

    await this.promotionAudit.create({
      chat_session_id: params.chatSessionId,
      profile_id: params.profileId,
      session_memory_id: params.candidate.id,
      profile_memory_id: params.existingMemory.id,
      action: 'updated',
      idempotency_key: params.idempotencyKey,
      trigger_reason: params.triggerReason,
      metadata: {
        mergedContentLength: mergedContent.length,
      },
    });

    await this.sessionMemory.markDistilled(
      [params.candidate.id],
      params.existingMemory.id,
    );

    await this.eventPublisher.publish({
      eventType: 'chat.memory.updated.v1',
      correlationId: params.correlationId,
      chatSessionId: params.chatSessionId,
      memoryId: params.existingMemory.id,
      action: 'updated',
      profileId: params.profileId,
      metadata: {
        triggerReason: params.triggerReason,
      },
    });
  }

  private async publishArchiveEvent(params: {
    archivedMemoryId: string;
    chatSessionId: string | null | undefined;
    profileId: string;
    correlationId: string;
    triggerReason: string;
    idempotencyKey: string;
  }): Promise<void> {
    const existingAudit = await this.promotionAudit.findByIdempotencyKey(
      params.idempotencyKey,
    );
    if (existingAudit) {
      return;
    }

    await this.promotionAudit.create({
      chat_session_id: params.chatSessionId ?? null,
      profile_id: params.profileId,
      session_memory_id: null,
      profile_memory_id: params.archivedMemoryId,
      action: 'archived',
      idempotency_key: params.idempotencyKey,
      trigger_reason: params.triggerReason,
      metadata: null,
    });

    await this.eventPublisher.publish({
      eventType: 'chat.memory.updated.v1',
      correlationId: params.correlationId,
      chatSessionId: params.chatSessionId ?? params.profileId,
      memoryId: params.archivedMemoryId,
      action: 'archived',
      profileId: params.profileId,
      metadata: {
        triggerReason: params.triggerReason,
      },
    });
  }
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(1, value));
}

function groupByNormalization(
  memories: Array<{
    id: string;
    normalized_content: string;
    memory_type: 'preference' | 'fact' | 'history';
    updated_at: Date;
    last_chat_session_id?: string | null;
  }>,
): Map<string, typeof memories> {
  const groups = new Map<string, typeof memories>();

  for (const memory of memories) {
    const key = `${memory.memory_type}:${memory.normalized_content}`;
    const existing = groups.get(key) ?? [];
    existing.push(memory);
    groups.set(key, existing);
  }

  return groups;
}
