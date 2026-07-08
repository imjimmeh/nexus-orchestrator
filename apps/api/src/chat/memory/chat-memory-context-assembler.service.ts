import { randomUUID } from 'node:crypto';
import { Injectable, Logger, Optional, Inject } from '@nestjs/common';
import { ChatProfileMemoryRepository } from '../database/repositories/chat-profile-memory.repository';
import { ChatSessionMemoryRepository } from '../database/repositories/chat-session-memory.repository';
import { resolveChatMemoryConfig } from './chat-memory.config';
import { ChatMemoryMetricsService } from './chat-memory-metrics.service';
import { MemoryTokenBudgetResolver } from '../../memory/memory-token-budget.resolver';
import type {
  BuildChatMemoryContextInput,
  ChatMemoryContextResult,
  ChatMemoryContextSlice,
} from './chat-memory.types';

type ScoredMemoryCandidate = {
  memoryId: string;
  source: 'session' | 'profile';
  memoryType: 'preference' | 'fact' | 'history';
  content: string;
  score: number;
  createdAt: Date;
};

/**
 * Assembles the `memory_context` block that ships to the agent prompt.
 *
 * Memory-budget wiring (Milestone 3 / M3):
 *  - When the caller does not supply an explicit `tokenBudget` on
 *    `BuildChatMemoryContextInput`, this service now resolves the
 *    active model's memory slice via {@link MemoryTokenBudgetResolver}
 *    and uses `budget.memory` (the 60% slice of the context window)
 *    as the cap. This brings the chat-side `memory_context` path in
 *    line with the chat-side `Session Context` path, which is also
 *    bounded by `budget.memory` post-M2. Both paths now agree on the
 *    cap, so a single `MemoryTokenBudgetResolver` instance is the
 *    single source of truth for the active model's memory budget.
 *  - The resolver is injected as an OPTIONAL dependency (the
 *    constructor accepts `null`/`undefined`) so unit tests that do
 *    not exercise the resolver path can construct the service
 *    without it. When the resolver is absent or fails, the service
 *    logs a warning and falls back to the historical
 *    `CHAT_MEMORY_CONTEXT_TOKEN_BUDGET` config default (default
 *    600 tokens), matching the pre-M3 behaviour so the chat path
 *    stays non-fatal.
 *  - The character budget is still derived from the token budget
 *    via the documented `tokenBudget * 4` approximation; we do not
 *    introduce a new character-counting knob.
 */
@Injectable()
export class ChatMemoryContextAssemblerService {
  private readonly logger = new Logger(ChatMemoryContextAssemblerService.name);
  private readonly config = resolveChatMemoryConfig();

  constructor(
    private readonly sessionMemory: ChatSessionMemoryRepository,
    private readonly profileMemory: ChatProfileMemoryRepository,
    private readonly metrics: ChatMemoryMetricsService,
    @Inject(MemoryTokenBudgetResolver)
    @Optional()
    private readonly budgetResolver: MemoryTokenBudgetResolver | null,
  ) {}

  async assembleContext(
    input: BuildChatMemoryContextInput,
  ): Promise<ChatMemoryContextResult> {
    const tokenBudget =
      input.tokenBudget ?? (await this.resolveTokenBudget(input));
    const maxSlices = input.maxSlices ?? this.config.contextMaxSlices;
    const messageTerms = extractTerms(input.prompt);

    const sessionRows = await this.sessionMemory.findRecentBySession(
      input.chatSessionId,
      maxSlices * 4,
    );
    const profileRows = await this.profileMemory.findActiveByProfile(
      input.profileId,
      maxSlices * 6,
    );

    const candidates = [
      ...sessionRows.map((row) =>
        this.toSessionCandidate(row, messageTerms, input.prompt),
      ),
      ...profileRows.map((row) =>
        this.toProfileCandidate(row, messageTerms, input.prompt),
      ),
    ];

    const selected = selectWithinBudget(candidates, {
      maxSlices,
      characterBudget: tokenBudget * 4,
    });

    const selectedProfileIds = selected
      .filter((slice) => slice.source === 'profile')
      .map((slice) => slice.memoryId);
    await this.profileMemory.touchAccessed(selectedProfileIds);

    this.metrics.recordRetrieval(selected.length);

    return {
      retrieval: {
        retrievalId: randomUUID(),
        requestedAt: new Date().toISOString(),
        tokenBudget,
        hitCount: selected.length,
        sessionHitCount: selected.filter((slice) => slice.source === 'session')
          .length,
        profileHitCount: selected.filter((slice) => slice.source === 'profile')
          .length,
        consumedCharacters: selected.reduce(
          (total, slice) => total + slice.content.length,
          0,
        ),
      },
      slices: selected,
    };
  }

  /**
   * Resolve the token budget for this assembly.
   *
   *  - If the caller supplied an explicit `tokenBudget` in the input
   *    we never reach this method (the caller is authoritative).
   *  - If the resolver is not wired in (null/undefined) we fall back
   *    to the documented config default so the assembler remains
   *    usable from contexts that have not migrated to the resolver
   *    (e.g. older test harnesses).
   *  - If the resolver throws or returns a non-positive memory slice,
   *    we log a warning and fall back to the config default; the
   *    chat path is non-fatal by design. This mirrors the
   *    resolver-failure semantics in
   *    `ChatSessionContextService.boundBlocksByMemoryBudget`.
   */
  private async resolveTokenBudget(
    input: BuildChatMemoryContextInput,
  ): Promise<number> {
    if (!this.budgetResolver) {
      return this.config.contextTokenBudget;
    }

    try {
      const budget = await this.budgetResolver.resolve();
      if (Number.isFinite(budget.memory) && budget.memory > 0) {
        return budget.memory;
      }

      this.logger.warn(
        `MemoryTokenBudgetResolver returned a non-positive memory slice ` +
          `(${budget.memory.toString()}) for chat session ` +
          `${input.chatSessionId}; falling back to ` +
          `CHAT_MEMORY_CONTEXT_TOKEN_BUDGET (${this.config.contextTokenBudget.toString()}).`,
      );
      return this.config.contextTokenBudget;
    } catch (error) {
      this.logger.warn(
        `MemoryTokenBudgetResolver failed for chat session ` +
          `${input.chatSessionId}; falling back to ` +
          `CHAT_MEMORY_CONTEXT_TOKEN_BUDGET ` +
          `(${this.config.contextTokenBudget.toString()}). ` +
          `Error: ${(error as Error).message}`,
      );
      return this.config.contextTokenBudget;
    }
  }

  private toSessionCandidate(
    row: {
      id: string;
      memory_type: 'preference' | 'fact' | 'history';
      content: string;
      normalized_content: string;
      importance_score: number;
      created_at: Date;
    },
    messageTerms: string[],
    prompt: string,
  ): ScoredMemoryCandidate {
    const relevanceScore = calculateRelevanceScore(
      row.normalized_content,
      messageTerms,
      prompt,
    );

    return {
      memoryId: row.id,
      source: 'session',
      memoryType: row.memory_type,
      content: row.content,
      score: relevanceScore + row.importance_score / 100 + 0.1,
      createdAt: row.created_at,
    };
  }

  private toProfileCandidate(
    row: {
      id: string;
      memory_type: 'preference' | 'fact' | 'history';
      content: string;
      normalized_content: string;
      confidence_score: number;
      updated_at: Date;
    },
    messageTerms: string[],
    prompt: string,
  ): ScoredMemoryCandidate {
    const relevanceScore = calculateRelevanceScore(
      row.normalized_content,
      messageTerms,
      prompt,
    );

    return {
      memoryId: row.id,
      source: 'profile',
      memoryType: row.memory_type,
      content: row.content,
      score: relevanceScore + row.confidence_score / 100 + 0.2,
      createdAt: row.updated_at,
    };
  }
}

function calculateRelevanceScore(
  normalizedContent: string,
  terms: string[],
  prompt: string,
): number {
  const overlapCount = terms.filter((term) =>
    normalizedContent.includes(term),
  ).length;
  const overlapScore = overlapCount / Math.max(terms.length, 1);

  const promptIncludesContent = prompt
    .toLowerCase()
    .includes(normalizedContent.substring(0, 40))
    ? 0.2
    : 0;

  return overlapScore + promptIncludesContent;
}

function extractTerms(input: string): string[] {
  const normalized = input.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const unique = new Set(
    normalized
      .split(/\s+/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 4),
  );

  return Array.from(unique);
}

function selectWithinBudget(
  candidates: ScoredMemoryCandidate[],
  options: { maxSlices: number; characterBudget: number },
): ChatMemoryContextSlice[] {
  const sorted = [...candidates].sort((left, right) => {
    if (right.score === left.score) {
      return right.createdAt.getTime() - left.createdAt.getTime();
    }

    return right.score - left.score;
  });

  const selected: ChatMemoryContextSlice[] = [];
  let consumed = 0;

  for (const candidate of sorted) {
    if (selected.length >= options.maxSlices) {
      break;
    }

    const nextSize = consumed + candidate.content.length;
    if (selected.length > 0 && nextSize > options.characterBudget) {
      continue;
    }

    consumed = nextSize;
    selected.push({
      memoryId: candidate.memoryId,
      source: candidate.source,
      memoryType: candidate.memoryType,
      content: candidate.content,
      score: Number(candidate.score.toFixed(4)),
      createdAt: candidate.createdAt.toISOString(),
    });
  }

  return selected;
}
