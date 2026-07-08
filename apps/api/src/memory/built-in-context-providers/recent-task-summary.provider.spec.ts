import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentTaskSummaryProvider } from './recent-task-summary.provider';
import { ChatSession } from '../../chat/database/entities/chat-session.entity';
import type { MemoryListingService } from '../memory-listing.service';
import type { MemorySegmentListItem } from '../memory-listing.types';

/**
 * Vitest unit tests for `RecentTaskSummaryProvider`.
 *
 * The provider depends only on `MemoryListingService` (cross-module via
 * the `forwardRef` cycle resolved in M2), so the tests instantiate it
 * directly with a `vi.fn()` mock — same pattern used by
 * `memory-listing.service.spec.ts` and the controller specs that inject
 * `MemoryListingService` directly.
 *
 * Coverage:
 *   (a) `canProvide` returns false when `scopeId` is null.
 *   (b) `canProvide` returns false when the listing service reports
 *       zero history segments.
 *   (c) `canProvide` returns true and `getContext` returns a markdown
 *       block containing the single segment's content.
 *   (d) `getContext` caps the rendered list at five segments even when
 *       the listing service returns more.
 */
describe('RecentTaskSummaryProvider', () => {
  const listSegments = vi.fn();

  let provider: RecentTaskSummaryProvider;

  function buildSession(overrides: Partial<ChatSession> = {}): ChatSession {
    return {
      id: 'sess-1',
      agent_profile_id: 'ap-1',
      agent_profile_name: 'agent-1',
      initial_message: 'hi',
      status: 'RUNNING' as ChatSession['status'],
      container_tier: 2,
      source: 'ad_hoc' as ChatSession['source'],
      session_type: 'general' as ChatSession['session_type'],
      created_at: new Date('2026-01-01T00:00:00.000Z'),
      updated_at: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    } as ChatSession;
  }

  function buildSegment(
    overrides: Partial<MemorySegmentListItem> = {},
  ): MemorySegmentListItem {
    return {
      id: 'seg-1',
      entity_type: 'Project',
      entity_id: 'scope-1',
      content: 'Refactored auth module',
      memory_type: 'history',
      version: 1,
      metadata: null,
      created_at: '2026-05-16T00:00:00.000Z',
      updated_at: '2026-05-16T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new RecentTaskSummaryProvider({
      listSegments,
    });
  });

  it('returns false from canProvide when scopeId is null', async () => {
    const session = buildSession({ scopeId: null });

    const result = await provider.canProvide(session);

    expect(result).toBe(false);
    expect(listSegments).not.toHaveBeenCalled();
  });

  it('returns false from canProvide when MemoryListingService reports zero history segments', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    listSegments.mockResolvedValue({
      items: [],
      total: 0,
      limit: 1,
      offset: 0,
    });

    const result = await provider.canProvide(session);

    expect(result).toBe(false);
    expect(listSegments).toHaveBeenCalledTimes(1);
    expect(listSegments).toHaveBeenCalledWith({
      entityType: 'Project',
      entityId: 'scope-1',
      memoryType: 'history',
      limit: 1,
      offset: 0,
    });
  });

  it('returns true from canProvide and renders a markdown block with the segment content when one history segment exists', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    const segment = buildSegment({
      content: 'Closed milestone M3 wiring',
      created_at: '2026-05-20T12:00:00.000Z',
    });

    // First call (canProvide) sees total: 1; second call (getContext)
    // returns the same single segment.
    listSegments.mockResolvedValueOnce({
      items: [segment],
      total: 1,
      limit: 1,
      offset: 0,
    });
    listSegments.mockResolvedValueOnce({
      items: [segment],
      total: 1,
      limit: 5,
      offset: 0,
    });

    const applicable = await provider.canProvide(session);
    expect(applicable).toBe(true);

    const block = await provider.getContext(session);

    expect(block.title).toBe('Recent Tasks');
    expect(block.priority).toBe(180);
    expect(block.content).toContain('## Recent Tasks');
    expect(block.content).toContain(
      `- ${segment.created_at}: ${segment.content}`,
    );
    expect(block.metadata).toEqual(
      expect.objectContaining({
        source: 'recent-task-summary',
        provider: 'recent-task-summary',
        cacheTtlSeconds: 300,
        segmentCount: 1,
      }),
    );
  });

  it('caps the rendered block at 5 segments when MemoryListingService returns 8', async () => {
    const session = buildSession({ scopeId: 'scope-1' });

    // Eight unsorted fixtures so we can assert the provider sorts and
    // caps independently of the order returned by the listing service.
    const unsorted = [
      buildSegment({
        id: 'seg-1',
        created_at: '2026-05-10T00:00:00.000Z',
        content: 'one',
      }),
      buildSegment({
        id: 'seg-2',
        created_at: '2026-05-15T00:00:00.000Z',
        content: 'two',
      }),
      buildSegment({
        id: 'seg-3',
        created_at: '2026-05-20T00:00:00.000Z',
        content: 'three',
      }),
      buildSegment({
        id: 'seg-4',
        created_at: '2026-05-25T00:00:00.000Z',
        content: 'four',
      }),
      buildSegment({
        id: 'seg-5',
        created_at: '2026-05-30T00:00:00.000Z',
        content: 'five',
      }),
      buildSegment({
        id: 'seg-6',
        created_at: '2026-06-01T00:00:00.000Z',
        content: 'six',
      }),
      buildSegment({
        id: 'seg-7',
        created_at: '2026-06-05T00:00:00.000Z',
        content: 'seven',
      }),
      buildSegment({
        id: 'seg-8',
        created_at: '2026-06-10T00:00:00.000Z',
        content: 'eight',
      }),
    ];

    listSegments.mockResolvedValueOnce({
      items: unsorted,
      total: 8,
      limit: 5,
      offset: 0,
    });

    const block = await provider.getContext(session);

    const bulletMatches = block.content.match(/^- /gm) ?? [];
    expect(bulletMatches).toHaveLength(5);

    // The newest five by created_at must be the ones rendered, in DESC
    // order. Older segments (one/two/three) must NOT appear.
    expect(block.content).toContain('- 2026-06-10T00:00:00.000Z: eight');
    expect(block.content).toContain('- 2026-06-05T00:00:00.000Z: seven');
    expect(block.content).toContain('- 2026-06-01T00:00:00.000Z: six');
    expect(block.content).toContain('- 2026-05-30T00:00:00.000Z: five');
    expect(block.content).toContain('- 2026-05-25T00:00:00.000Z: four');
    expect(block.content).not.toContain('three');
    expect(block.content).not.toContain('two');
    expect(block.content).not.toContain('one');

    // Newest segment appears before older ones — confirms DESC sort.
    const eightIndex = block.content.indexOf('eight');
    const fourIndex = block.content.indexOf('four');
    expect(eightIndex).toBeGreaterThan(-1);
    expect(fourIndex).toBeGreaterThan(-1);
    expect(eightIndex).toBeLessThan(fourIndex);

    expect(listSegments).toHaveBeenCalledWith({
      entityType: 'Project',
      entityId: 'scope-1',
      memoryType: 'history',
      limit: 5,
      offset: 0,
    });

    expect(block.metadata).toEqual(
      expect.objectContaining({
        source: 'recent-task-summary',
        provider: 'recent-task-summary',
        cacheTtlSeconds: 300,
        segmentCount: 5,
      }),
    );
  });
});
