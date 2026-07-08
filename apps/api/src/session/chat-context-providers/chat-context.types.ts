import { ChatSession } from '../../chat/database/entities/chat-session.entity';
import type {
  PromptAssemblyContext,
  PromptContributionBlock,
} from '../../system-prompt/system-prompt-contributor.types';

/**
 * A chat context provider that loads and formats information from a specific source.
 * Providers are pluggable and can be registered at runtime without modifying core services.
 */
export interface IChatContextProvider {
  /**
   * Provider name for logging, metadata, and debugging.
   */
  readonly name: string;

  /**
   * Determines if this provider is applicable to the given chat session.
   * Providers can check session properties (e.g., scope_id, source) to decide applicability.
   *
   * @param session The chat session to evaluate.
   * @returns true if this provider should load context for this session.
   */
  canProvide(session: ChatSession): Promise<boolean>;

  /**
   * Load and format context from this provider's source.
   *
   * @param session The chat session to load context for.
   * @returns A context block with title, markdown content, and metadata.
   */
  getContext(session: ChatSession): Promise<ChatContextBlock>;

  /**
   * Display priority (higher = earlier in the final context message).
   * Default: 100
   */
  readonly priority?: number;

  /**
   * Cache TTL in seconds. If provided, blocks are cached for this duration.
   * null = no caching. Default: no caching.
   */
  readonly cacheTtlSeconds?: number | null;
}

/**
 * A formatted block of context for a chat session's system message.
 * Structurally identical to PromptContributionBlock — aliased so chat and
 * workflow share one block shape.
 */
export type ChatContextBlock = PromptContributionBlock;

/** Chat-scoped assembly context. Carries the loaded ChatSession for adapters. */
export interface ChatPromptAssemblyContext extends PromptAssemblyContext {
  runType: 'chat';
  session: ChatSession;
}

/**
 * Metadata snapshot of context injection event, stored in chat_sessions.context_metadata.
 */
export interface ChatContextMetadata {
  /**
   * Timestamp when context was injected.
   */
  injected_at: Date;

  /**
   * Names of providers that contributed blocks.
   */
  providers_used: string[];

  /**
   * Number of blocks injected.
   */
  block_count: number;

  /**
   * Context version, for future compatibility tracking.
   */
  version: string;
}
