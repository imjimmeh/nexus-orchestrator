import type { Logger } from '@nestjs/common';
import type { ChatActionMemoryContext } from '../chat-actions/chat-actions.types';
import type { ChatMemoryLifecycleService } from '../memory/chat-memory-lifecycle.service';
import type { ChatMemoryContextResult } from '../memory/chat-memory.types';

export function buildMemoryRetrievalMetadata(
  memoryContext: ChatMemoryContextResult | null,
): Record<string, unknown> | null {
  if (!memoryContext) {
    return null;
  }

  return {
    retrievalId: memoryContext.retrieval.retrievalId,
    hitCount: memoryContext.retrieval.hitCount,
    sessionHitCount: memoryContext.retrieval.sessionHitCount,
    profileHitCount: memoryContext.retrieval.profileHitCount,
    tokenBudget: memoryContext.retrieval.tokenBudget,
    sliceIds: memoryContext.slices.map((slice) => slice.memoryId),
  };
}

export function toActionMemoryContext(
  memoryContext: ChatMemoryContextResult | null,
): ChatActionMemoryContext | null {
  if (!memoryContext) {
    return null;
  }

  return {
    retrievalId: memoryContext.retrieval.retrievalId,
    hitCount: memoryContext.retrieval.hitCount,
    sessionHitCount: memoryContext.retrieval.sessionHitCount,
    profileHitCount: memoryContext.retrieval.profileHitCount,
    tokenBudget: memoryContext.retrieval.tokenBudget,
    slices: memoryContext.slices.map((slice) => ({
      memoryId: slice.memoryId,
      source: slice.source,
      memoryType: slice.memoryType,
      content: slice.content,
      score: slice.score,
    })),
  };
}

export async function buildMemoryContextSafe(params: {
  memoryLifecycle: ChatMemoryLifecycleService;
  logger: Logger;
  chatSessionId: string;
  profileId: string;
  prompt: string;
  /**
   * Graduated-rollout guard. When `false`, the helper short-circuits to
   * `null` without invoking the memory lifecycle, so retrieval/scoring
   * costs are avoided when the feature is off. Defaults to `true` to
   * preserve the pre-flag behavior.
   */
  enabled?: boolean;
}): Promise<ChatMemoryContextResult | null> {
  if (params.enabled === false) {
    return null;
  }

  try {
    return await params.memoryLifecycle.buildActionContext({
      chatSessionId: params.chatSessionId,
      profileId: params.profileId,
      prompt: params.prompt,
    });
  } catch (error) {
    params.logger.warn(
      `Memory context assembly failed for chat ${params.chatSessionId}: ${(error as Error).message}`,
    );
    return null;
  }
}

export async function recordInboundMemorySafe(params: {
  memoryLifecycle: ChatMemoryLifecycleService;
  logger: Logger;
  chatSessionId: string;
  profileId: string;
  sourceMessageId: string;
  content: string;
  correlationId: string | null;
  channel: string;
  metadata: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await params.memoryLifecycle.recordInboundMessage({
      chatSessionId: params.chatSessionId,
      profileId: params.profileId,
      sourceMessageId: params.sourceMessageId,
      sourceRole: 'user',
      content: params.content,
      correlationId: params.correlationId,
      channel: params.channel,
      metadata: params.metadata,
    });
  } catch (error) {
    params.logger.warn(
      `Inbound memory recording failed for chat ${params.chatSessionId}: ${(error as Error).message}`,
    );
  }
}

export async function recordOutboundMemorySafe(params: {
  memoryLifecycle: ChatMemoryLifecycleService;
  logger: Logger;
  chatSessionId: string;
  profileId: string;
  sourceMessageId: string;
  content: string;
  channel: string;
  metadata: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await params.memoryLifecycle.recordOutboundMessage({
      chatSessionId: params.chatSessionId,
      profileId: params.profileId,
      sourceMessageId: params.sourceMessageId,
      sourceRole: 'assistant',
      content: params.content,
      channel: params.channel,
      metadata: params.metadata,
    });
  } catch (error) {
    params.logger.warn(
      `Outbound memory recording failed for chat ${params.chatSessionId}: ${(error as Error).message}`,
    );
  }
}
