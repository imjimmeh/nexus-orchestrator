import { Injectable, Logger } from '@nestjs/common';
import type {
  ChatContextBlock,
  IChatContextProvider,
} from '../../session/chat-context-providers/chat-context.provider.interface';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';
import { MemoryListingService } from '../memory-listing.service';

/**
 * User preference echo provider.
 *
 * Surfaces the durable user-preference memory segments recorded against
 * the chat session's scope (interpreted here as a neutral platform
 * `User` identifier — `entityType='User'`, `entityId=<scopeId>`). The
 * preference stream is the long-lived trail of how the user likes the
 * assistant to behave (tone, format, defaults, etc.); surfacing it in
 * the chat context gives the assistant a working memory of those
 * preferences without re-reading the full chat message log.
 *
 * Long TTL (1800s = 30 min) because user preferences are stable for the
 * duration of a working session — preferences change on the order of
 * weeks, not minutes.
 *
 * Wiring notes:
 *   - `MemoryListingService` lives in `MemoryModule`, which is imported
 *     via `forwardRef` on both edges of the cycle with
 *     `BuiltInMemoryContextProvidersModule` (see M2). The module graph
 *     wiring handles the cycle resolution; constructor injection of the
 *     service is plain and does not need a `forwardRef` of its own.
 *   - `canProvide` is the adapter's "drop the contribution" gate (see
 *     `ChatContextProviderAdapter.contribute`). Returning `false` here
 *     causes the orchestrator to skip the block entirely, so a session
 *     without a scope or without any preference segments does not
 *     surface an empty "User Preferences" header to the model.
 *   - `getContext` always returns a `ChatContextBlock` per the
 *     `IChatContextProvider` contract. The list of preference segments
 *     is capped at ten so the block stays inside the provider's cache
 *     and budget bounds; segments are sorted by `created_at` descending
 *     so the most recent preference lands at the top.
 *
 * Load-order contract (pinned by
 * `built-in-memory-context-providers.module.spec.ts`):
 *   - `name`: `user-preference-echo`
 *   - `priority`: `220` (lowest of the five built-in providers — user
 *     preferences are long-lived and broadly applicable, so they anchor
 *     the bottom of the chat context; the more recent and
 *     scope-specific signals land above)
 *   - `cacheTtlSeconds`: `1800` (30 minutes — preferences change on
 *     the order of weeks, not minutes, so a long TTL is appropriate)
 */
@Injectable()
export class UserPreferenceEchoProvider implements IChatContextProvider {
  private readonly logger = new Logger(UserPreferenceEchoProvider.name);

  /** Neutral platform identifier used for the preference entity scope. */
  static readonly ENTITY_TYPE = 'User';

  /** Maximum number of preference segments surfaced per block. */
  static readonly MAX_SEGMENTS = 10;

  readonly name = 'user-preference-echo';
  readonly priority = 220;
  readonly cacheTtlSeconds = 1800;

  constructor(private readonly memoryListingService: MemoryListingService) {}

  async canProvide(session: ChatSession): Promise<boolean> {
    const scopeId = session?.scopeId;
    if (typeof scopeId !== 'string' || scopeId.length === 0) {
      return false;
    }

    const page = await this.memoryListingService.listSegments({
      entityType: UserPreferenceEchoProvider.ENTITY_TYPE,
      entityId: scopeId,
      memoryType: 'preference',
      limit: 1,
      offset: 0,
    });

    return page.total > 0;
  }

  async getContext(session: ChatSession): Promise<ChatContextBlock> {
    const scopeId = session?.scopeId;
    if (typeof scopeId !== 'string' || scopeId.length === 0) {
      // Defensive: `canProvide` gates this, but a direct caller that
      // bypasses the adapter (e.g. a unit test) should still receive a
      // well-formed block rather than a crash.
      return this.buildEmptyBlock();
    }

    const page = await this.memoryListingService.listSegments({
      entityType: UserPreferenceEchoProvider.ENTITY_TYPE,
      entityId: scopeId,
      memoryType: 'preference',
      limit: UserPreferenceEchoProvider.MAX_SEGMENTS,
      offset: 0,
    });

    if (page.total === 0) {
      return this.buildEmptyBlock();
    }

    const preferences = [...page.items]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, UserPreferenceEchoProvider.MAX_SEGMENTS);

    const lines = preferences.map(
      (item) => `- ${item.created_at}: ${item.content}`,
    );

    return {
      title: 'User Preferences',
      content: ['## User Preferences', '', ...lines].join('\n'),
      priority: this.priority,
      metadata: {
        source: 'user-preference-echo',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
        segmentCount: preferences.length,
      },
    };
  }

  private buildEmptyBlock(): ChatContextBlock {
    return {
      title: 'User Preferences',
      content:
        '## User Preferences\n\n_No recorded user preferences for this user yet._',
      priority: this.priority,
      metadata: {
        source: 'user-preference-echo',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
        segmentCount: 0,
      },
    };
  }
}
