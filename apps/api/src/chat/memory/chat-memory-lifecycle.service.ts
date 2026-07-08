import { Injectable } from '@nestjs/common';
import { ChatSessionMemoryRepository } from '../database/repositories/chat-session-memory.repository';
import { resolveChatMemoryConfig } from './chat-memory.config';
import { ChatMemoryContextAssemblerService } from './chat-memory-context-assembler.service';
import { ChatMemoryJobService } from './chat-memory-job.service';
import type {
  BuildChatMemoryContextInput,
  ChatMemoryContextResult,
  ChatMemoryType,
  RecordSessionMemoryInput,
} from './chat-memory.types';

@Injectable()
export class ChatMemoryLifecycleService {
  private readonly config = resolveChatMemoryConfig();

  constructor(
    private readonly sessionMemory: ChatSessionMemoryRepository,
    private readonly jobs: ChatMemoryJobService,
    private readonly contextAssembler: ChatMemoryContextAssemblerService,
  ) {}

  async buildActionContext(
    input: BuildChatMemoryContextInput,
  ): Promise<ChatMemoryContextResult> {
    return this.contextAssembler.assembleContext(input);
  }

  async recordInboundMessage(input: RecordSessionMemoryInput): Promise<void> {
    await this.recordSessionMemory({
      ...input,
      memoryType: inferInboundMemoryType(input.content),
    });

    await this.maybeQueueTurnCountDistillation(
      input.chatSessionId,
      input.profileId,
    );
  }

  async recordOutboundMessage(input: RecordSessionMemoryInput): Promise<void> {
    await this.recordSessionMemory({
      ...input,
      memoryType: 'history',
    });
  }

  async handleSessionClosed(params: {
    chatSessionId: string;
    profileId: string;
  }): Promise<void> {
    await this.jobs.enqueueDistillation({
      chatSessionId: params.chatSessionId,
      profileId: params.profileId,
      triggerReason: 'session_close',
      idempotencyKey: `distill:session_close:${params.chatSessionId}`,
    });
  }

  private async recordSessionMemory(
    input: RecordSessionMemoryInput & { memoryType: ChatMemoryType },
  ): Promise<void> {
    const normalizedContent = normalizeMemoryContent(input.content);
    if (normalizedContent.length === 0) {
      return;
    }

    await this.sessionMemory.create({
      chat_session_id: input.chatSessionId,
      profile_id: input.profileId,
      source_message_id: input.sourceMessageId,
      source_role: input.sourceRole,
      memory_type: input.memoryType,
      content: input.content,
      normalized_content: normalizedContent,
      importance_score: scoreImportance(normalizedContent, input.memoryType),
      provenance: {
        channel: input.channel ?? null,
        correlationId: input.correlationId ?? null,
        ...(input.metadata ?? {}),
      },
    });

    await this.sessionMemory.pruneBySession(
      input.chatSessionId,
      this.config.maxSessionEntries,
    );
  }

  private async maybeQueueTurnCountDistillation(
    chatSessionId: string,
    profileId: string,
  ): Promise<void> {
    const total = await this.sessionMemory.countBySession(chatSessionId);
    if (total < this.config.distillationTurnInterval) {
      return;
    }

    if (total % this.config.distillationTurnInterval !== 0) {
      return;
    }

    const window = Math.floor(total / this.config.distillationTurnInterval);
    await this.jobs.enqueueDistillation({
      chatSessionId,
      profileId,
      triggerReason: 'turn_count',
      idempotencyKey: `distill:turn_count:${chatSessionId}:${window}`,
    });
  }
}

function inferInboundMemoryType(content: string): ChatMemoryType {
  const normalized = normalizeMemoryContent(content);
  if (normalized.includes('i prefer') || normalized.includes('my preference')) {
    return 'preference';
  }

  if (normalized.includes('remember') || normalized.includes('always')) {
    return 'fact';
  }

  return 'history';
}

function normalizeMemoryContent(content: string): string {
  return content
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9\s.,:;!?-]/g, '')
    .trim();
}

function scoreImportance(content: string, memoryType: ChatMemoryType): number {
  let base = 45;

  if (memoryType === 'preference') {
    base = 75;
  }

  if (memoryType === 'fact') {
    base = 65;
  }

  if (content.length > 180) {
    base += 10;
  }

  if (content.includes('deadline') || content.includes('blocked')) {
    base += 8;
  }

  return Math.min(base, 100);
}
