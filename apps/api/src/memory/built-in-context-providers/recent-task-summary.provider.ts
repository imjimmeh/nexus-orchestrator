import { Injectable } from '@nestjs/common';
import type {
  ChatContextBlock,
  IChatContextProvider,
} from '../../session/chat-context-providers/chat-context.provider.interface';
import type { ChatSession } from '../../chat/database/entities/chat-session.entity';
import { MemoryListingService } from '../memory-listing.service';
import type { MemorySegmentListItem } from '../memory-listing.types';

@Injectable()
export class RecentTaskSummaryProvider implements IChatContextProvider {
  /** Neutral platform identifier used for the history entity scope. */
  static readonly ENTITY_TYPE = 'Project';

  /** Maximum number of history segments surfaced per block. */
  static readonly MAX_SEGMENTS = 5;

  readonly name = 'recent-task-summary';
  readonly priority = 180;
  readonly cacheTtlSeconds = 300;

  constructor(private readonly memoryListingService: MemoryListingService) {}

  async canProvide(session: ChatSession): Promise<boolean> {
    if (!session.scopeId) {
      return false;
    }
    const page = await this.memoryListingService.listSegments({
      entityType: RecentTaskSummaryProvider.ENTITY_TYPE,
      entityId: session.scopeId,
      memoryType: 'history',
      limit: 1,
      offset: 0,
    });
    return page.total > 0;
  }

  async getContext(session: ChatSession): Promise<ChatContextBlock> {
    if (!session.scopeId) {
      return this.stubBlock();
    }
    const page = await this.memoryListingService.listSegments({
      entityType: RecentTaskSummaryProvider.ENTITY_TYPE,
      entityId: session.scopeId,
      memoryType: 'history',
      limit: RecentTaskSummaryProvider.MAX_SEGMENTS,
      offset: 0,
    });
    const segments = [...page.items]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, RecentTaskSummaryProvider.MAX_SEGMENTS);

    if (segments.length === 0) {
      return this.stubBlock();
    }

    return {
      title: 'Recent Tasks',
      content: `## Recent Tasks\n\n${formatSegments(segments)}`,
      priority: this.priority,
      metadata: {
        source: 'recent-task-summary',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
        segmentCount: segments.length,
      },
    };
  }

  private stubBlock(): ChatContextBlock {
    return {
      title: 'Recent Tasks',
      content: '## Recent Tasks\n\nNo recent task summary available yet.',
      priority: this.priority,
      metadata: {
        source: 'recent-task-summary',
        provider: this.name,
        cacheTtlSeconds: this.cacheTtlSeconds,
      },
    };
  }
}

function formatSegments(segments: MemorySegmentListItem[]): string {
  return segments.map((s) => `- ${s.created_at}: ${s.content}`).join('\n');
}
