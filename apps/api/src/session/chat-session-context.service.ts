import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ChatSession } from '../chat/database/entities/chat-session.entity';
import { ChatSessionRepository } from '../chat/database/repositories/chat-session.repository';
import { ChatMessageRepository } from '../chat/database/repositories/chat-message.repository';
import {
  IChatContextProvider,
  ChatContextBlock,
  ChatContextMetadata,
} from './chat-context-providers/chat-context.provider.interface';
import type { ChatPromptAssemblyContext } from './chat-context-providers/chat-context.types';
import { ChatContextProviderAdapter } from './chat-context-providers/chat-context-provider.adapter';
import { SystemPromptAssemblyService } from '../system-prompt/system-prompt-assembly.service';
import { MemoryTokenBudgetResolver } from '../memory/memory-token-budget.resolver';
import { TokenCounterService } from '../memory/token-counter.service';
import { randomUUID } from 'node:crypto';

/**
 * Thrown by `ChatSessionContextService.assertRegistryNonEmpty` when the
 * provider registry is empty (e.g. because `BuiltInContextProviderRegistrar`
 * failed to register the built-in providers at bootstrap, or because all
 * providers were unregistered at runtime).
 *
 * Crashing the application at startup is intentional — see
 * `docs/architecture/memory-management.md` ("Built-in Context Provider
 * Bootstrap"): a chat session that runs with zero context providers means
 * the self-improvement feedback loop is silently broken.
 */
export class ChatContextRegistryEmptyError extends Error {
  readonly contextLabel: string;
  readonly registeredCount: number;

  constructor(contextLabel: string, registeredCount: number) {
    super(
      `Chat context provider registry is empty (${contextLabel}): expected at least 1 built-in provider, found ${registeredCount}. ` +
        `This usually means BuiltInMemoryContextProvidersModule failed to bootstrap. The application cannot start safely.`,
    );
    this.name = ChatContextRegistryEmptyError.name;
    this.contextLabel = contextLabel;
    this.registeredCount = registeredCount;
  }
}

/**
 * Orchestrates context discovery and injection for chat sessions.
 *
 * Discovers applicable providers, loads context blocks in parallel, applies
 * the active-model memory token budget cap (via {@link MemoryTokenBudgetResolver}),
 * caches the bounded blocks, and formats the surviving blocks into a markdown
 * message for prepending to chat sessions. Supports refresh on orchestration
 * events (phase changes, work item updates, etc.)
 *
 * Memory-budget wiring (Milestone 2 / M2):
 *  - The `memory_context` block that ships to the agent prompt is gated by the
 *    resolver's `budget.memory` slice. We chose **Option A** — inject
 *    `MemoryTokenBudgetResolver` directly into `ChatSessionContextService` —
 *    because the cap is a property of the *rendered* chat-side context message,
 *    not of any individual `IChatContextProvider`. A provider may legitimately
 *    emit a block larger than `budget.memory` (e.g. a project dump); the cap
 *    exists to bound the *sum* of all blocks after the final markdown render.
 *    Centralising the gate in `getContextBlocks` (which already orchestrates
 *    all providers) keeps the drop-ordering deterministic and avoids leaking
 *    resolver awareness into every provider. The resolver-failure semantics
 *    mirror `DistillationConsumer.resolveMemoryBudgetSafe`: log a warning and
 *    fall back to the unconstrained blocks so the chat path stays non-fatal.
 */
@Injectable()
export class ChatSessionContextService implements OnModuleInit {
  private readonly logger = new Logger(ChatSessionContextService.name);

  private contextCache: Map<
    string,
    { blocks: ChatContextBlock[]; expiresAt: number }
  > = new Map();

  constructor(
    private readonly chatSessionRepo: ChatSessionRepository,
    private readonly chatMessageRepo: ChatMessageRepository,
    private readonly budgetResolver: MemoryTokenBudgetResolver,
    private readonly tokenCounter: TokenCounterService,
    private readonly systemPromptAssembly: SystemPromptAssemblyService,
  ) {}

  onModuleInit(): void {
    this.logger.log('ChatSessionContextService initialized');
  }

  /**
   * Register a context provider (built-in or custom at runtime).
   * Delegates to the shared {@link SystemPromptAssemblyService} registry via
   * a {@link ChatContextProviderAdapter} so the chat path and the workflow
   * agent path share one contributor seam.
   */
  registerProvider(name: string, provider: IChatContextProvider): void {
    this.systemPromptAssembly.register(
      new ChatContextProviderAdapter(provider),
    );
    this.logger.debug(`Registered context provider: ${name}`);
  }

  /**
   * Return the registered provider names in insertion order.
   *
   * The order is meaningful: it is the `Map` insertion order, which is
   * the order the registrar iterated its built-in providers in
   * `BuiltInContextProviderRegistrar.onApplicationBootstrap`. New
   * providers registered at runtime are appended at the end.
   *
   * Used by the contract test in
   * `apps/api/src/memory/built-in-context-providers/built-in-memory-context-providers.module.spec.ts`
   * to pin the deterministic load order.
   */
  getRegisteredProviderNames(): string[] {
    return this.systemPromptAssembly.getRegisteredNames();
  }

  /**
   * Return the number of currently registered providers.
   */
  getRegisteredProviderCount(): number {
    return this.systemPromptAssembly.getRegisteredCount();
  }

  /**
   * Return true when no providers are registered.
   */
  isRegistryEmpty(): boolean {
    return this.systemPromptAssembly.isRegistryEmpty();
  }

  /**
   * Return true when at least one provider is registered.
   * Convenience for health indicators that need a single boolean.
   */
  isHealthy(): boolean {
    return !this.isRegistryEmpty();
  }

  /**
   * Throw `ChatContextRegistryEmptyError` if no providers are registered.
   *
   * Called from `BuiltInContextProviderRegistrar.onApplicationBootstrap`
   * (fails the app at startup) and from `ContextProviderHealthIndicator`
   * (fails `/health` with HTTP 503). `contextLabel` is included in the
   * error message to make triage easier.
   */
  assertRegistryNonEmpty(contextLabel: string = 'post-bootstrap'): void {
    if (this.isRegistryEmpty()) {
      throw new ChatContextRegistryEmptyError(
        contextLabel,
        this.getRegisteredProviderCount(),
      );
    }
  }

  /**
   * Test-only: empty the provider registry. Named with the `ForTesting`
   * suffix per codebase convention so it is obvious in code review that
   * the method must never be called from production code paths.
   */
  clearProvidersForTesting(): void {
    this.systemPromptAssembly.clearForTesting();
  }

  /**
   * Build full context message from applicable providers, sorted by priority.
   */
  async buildContextMessage(chatSessionId: string): Promise<string> {
    const session = await this.chatSessionRepo.findById(chatSessionId);
    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`);
    }

    const blocks = await this.getContextBlocks(session);
    return this.formatContextMessage(blocks);
  }

  /**
   * Inject context as the first system message in the session.
   * Called after container starts, before agent begins.
   */
  async injectContextMessage(chatSessionId: string): Promise<string> {
    const contextText = await this.buildContextMessage(chatSessionId);
    const session = await this.chatSessionRepo.findById(chatSessionId);

    if (!session) {
      throw new Error(`Chat session ${chatSessionId} not found`);
    }

    // Create system message
    await this.chatMessageRepo.create({
      id: randomUUID(),
      chat_session_id: chatSessionId,
      direction: 'outbound',
      sender: 'system',
      channel: 'api',
      event_type: 'context_injected',
      text: contextText,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: {
        auto_generated: true,
        version: 'v1',
      },
    });

    // Store snapshot in chat_sessions
    const blocks = await this.getContextBlocks(session);
    const metadata: ChatContextMetadata = {
      injected_at: new Date(),
      providers_used: blocks
        .map((b) => b.metadata?.provider as string | undefined)
        .filter((p) => !!p) as string[],
      block_count: blocks.length,
      version: 'v1',
    };

    await this.chatSessionRepo.update(chatSessionId, {
      context_metadata: metadata,
    });

    this.logger.log(
      `Context injected for session ${chatSessionId}: ${blocks.length} blocks from ${metadata.providers_used.join(', ')}`,
    );

    return contextText;
  }

  /**
   * Refresh context mid-session (e.g., after phase change, new work item published).
   * Clears cache and injects a new context message with reason.
   */
  async refreshContextMessage(
    chatSessionId: string,
    reason?: string,
  ): Promise<void> {
    this.contextCache.delete(chatSessionId);

    const newContextText = await this.buildContextMessage(chatSessionId);

    await this.chatMessageRepo.create({
      id: randomUUID(),
      chat_session_id: chatSessionId,
      direction: 'outbound',
      sender: 'system',
      channel: 'api',
      event_type: 'context_refreshed',
      text: newContextText,
      created_at: new Date(),
      updated_at: new Date(),
      metadata: {
        auto_generated: true,
        reason: reason || 'orchestration state change',
      },
    });

    this.logger.log(
      `Context refreshed for session ${chatSessionId}: ${reason || 'orchestration state change'}`,
    );
  }

  /**
   * Internal: Gather context blocks from applicable providers.
   * Delegates provider filtering, error resilience, and parallel execution
   * to {@link SystemPromptAssemblyService.gatherBlocks}, then applies the
   * active-model memory token budget cap and caches the result.
   */
  private async getContextBlocks(
    session: ChatSession,
  ): Promise<ChatContextBlock[]> {
    const cacheKey = session.id;
    const cached = this.contextCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      this.logger.debug(`Context cache hit for session ${session.id}`);
      return cached.blocks;
    }

    const ctx: ChatPromptAssemblyContext = {
      runType: 'chat',
      chatSessionId: session.id,
      scopeId: session.scopeId ?? undefined,
      model: session.model ?? undefined,
      baseLayers: [],
      session,
    };

    const { blocks, skipped } =
      await this.systemPromptAssembly.gatherBlocks(ctx);

    if (skipped.length > 0) {
      this.logger.warn(
        `Chat context gather skipped ${skipped.length} provider(s) for session ${session.id}: ` +
          skipped.map((s) => `${s.name}: ${s.reason}`).join('; '),
      );
    }

    // Apply the active-model memory token budget cap. The cap is
    // applied AFTER provider failures are translated to error blocks so
    // those error blocks participate in the same priority-based drop
    // order — the operator wants to see provider failures over a
    // low-priority informational block, so we keep the ordering
    // deterministic and only drop from the lowest-priority end.
    const boundedBlocks = await this.boundBlocksByMemoryBudget(session, blocks);

    // Cache the BOUNDED block set so subsequent reads within the TTL
    // window see the same gated message that was rendered the first
    // time. If the active model changes mid-session, the refresh
    // path (`refreshContextMessage`) clears the cache and re-runs.
    const minTtl = Math.min(
      ...boundedBlocks
        .map((b) => (b.metadata?.cacheTtlSeconds as number | undefined) ?? 300)
        .filter((ttl) => ttl && ttl > 0),
      300,
    );

    this.contextCache.set(cacheKey, {
      blocks: boundedBlocks,
      expiresAt: Date.now() + minTtl * 1000,
    });

    return boundedBlocks;
  }

  /**
   * Bound the rendered context message to the active model's memory
   * token budget slice (`MemoryTokenBudgetResolver.budget.memory`).
   *
   * Strategy:
   *   1. Resolve the budget via the injected resolver. When the
   *      resolver throws or reports a non-positive memory slice, log
   *      a warning and return the unbounded blocks so the chat path
   *      stays non-fatal (mirrors `DistillationConsumer.resolveMemoryBudgetSafe`).
   *   2. Format the current block set with `formatContextMessage` and
   *      count tokens against the session's model (or `unknown-model`
   *      when the session has no model assigned — tiktoken falls back
   *      to `cl100k_base`, which is conservative for the modern models
   *      the chat subsystem targets).
   *   3. While the formatted message exceeds `budget.memory` AND more
   *      than one block remains, drop the lowest-priority block. The
   *      drop order is deterministic: priority ascending (lowest
   *      first), tie-broken by original index (registration order)
   *      so the same input always produces the same output.
   *   4. A single oversized block is kept verbatim — we never
   *      truncate a block's content; the budget gate operates at the
   *      block boundary, not at the character/token boundary. The
   *      caller can decide to surface a warning in that case (logged
   *      here for observability).
   *
   * The method is `async` to match the resolver contract and to keep
   * the door open for an LLM-based summariser fallback in a future
   * milestone; the current implementation only does the cheap
   * format-and-drop pass.
   */
  private async boundBlocksByMemoryBudget(
    session: ChatSession,
    blocks: ChatContextBlock[],
  ): Promise<ChatContextBlock[]> {
    if (blocks.length === 0) {
      return blocks;
    }

    let budget;
    try {
      budget = await this.budgetResolver.resolve();
    } catch (error) {
      this.logger.warn(
        `MemoryTokenBudgetResolver failed for chat session ${session.id}; ` +
          `returning unconstrained context blocks. ` +
          `Error: ${(error as Error).message}`,
      );
      return blocks;
    }

    if (!Number.isFinite(budget.memory) || budget.memory <= 0) {
      this.logger.warn(
        `MemoryTokenBudgetResolver returned a non-positive memory slice ` +
          `(${budget.memory.toString()}) for chat session ${session.id}; ` +
          `returning unconstrained context blocks.`,
      );
      return blocks;
    }

    const modelForCounting = session.model ?? 'unknown-model';

    // Index the blocks so the drop order is deterministic when
    // priorities tie (preserves the order in which providers were
    // registered with the service).
    const ordered = blocks.map((block, index) => ({ block, index }));
    // Sort ascending by priority so the END of the array is the
    // lowest priority — we pop from the end.
    ordered.sort((a, b) => {
      if (a.block.priority !== b.block.priority) {
        return a.block.priority - b.block.priority;
      }
      return a.index - b.index;
    });

    const kept: ChatContextBlock[] = ordered.map((entry) => entry.block);

    while (kept.length > 1) {
      const formatted = this.formatContextMessage(kept);
      const tokenCount = this.tokenCounter.countTokens(
        formatted,
        modelForCounting,
      );
      if (tokenCount <= budget.memory) {
        return kept;
      }

      const dropped = kept.pop();
      const providerName = this.providerLabel(dropped);
      this.logger.warn(
        `Dropping context block "${dropped?.title ?? '<untitled>'}" ` +
          `(provider=${providerName}) ` +
          `for chat session ${session.id}: ` +
          `formatted message would exceed budget.memory ` +
          `(${tokenCount.toString()} > ${budget.memory.toString()} tokens ` +
          `for model ${modelForCounting}).`,
      );
    }

    // Single block remaining. Either it fits, or we keep it
    // verbatim because we never truncate block content at the
    // boundary.
    const finalFormatted = this.formatContextMessage(kept);
    const finalTokenCount = this.tokenCounter.countTokens(
      finalFormatted,
      modelForCounting,
    );
    if (finalTokenCount > budget.memory) {
      this.logger.warn(
        `A single context block exceeds budget.memory ` +
          `(${finalTokenCount.toString()} > ${budget.memory.toString()} tokens ` +
          `for model ${modelForCounting}) for chat session ${session.id}; ` +
          `keeping block verbatim because the budget gate operates at ` +
          `the block boundary.`,
      );
    }

    return kept;
  }

  /**
   * Format a block's provider name for log output.
   *
   * `ChatContextBlock.metadata.provider` is typed as `unknown` so we
   * only stringify when the value is a plain string. Anything else
   * (numbers, objects) is rendered as the literal `'unknown'` so the
   * log line never silently stringifies a structured object via
   * `[object Object]`.
   */
  private providerLabel(block: ChatContextBlock | undefined): string {
    const provider = block?.metadata?.provider;
    return typeof provider === 'string' && provider.length > 0
      ? provider
      : 'unknown';
  }

  /**
   * Format blocks into markdown message with header.
   */
  private formatContextMessage(blocks: ChatContextBlock[]): string {
    const header = `# Session Context

This context was automatically assembled at session start and reflects the current state of your project and work items. Refer to it for decision-making, but always verify critical information with the user or system before taking action.

---
`;

    const body = blocks
      .sort((a, b) => b.priority - a.priority)
      .map((block) => `## ${block.title}\n\n${block.content}`)
      .join('\n\n');

    return `${header}\n${body}`;
  }
}
