import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserPreferenceEchoProvider } from './user-preference-echo.provider';
import { ChatSession } from '../../chat/database/entities/chat-session.entity';
import type { MemoryListingService } from '../memory-listing.service';
import type { MemorySegmentListItem } from '../memory-listing.types';

/**
 * Vitest unit tests for `UserPreferenceEchoProvider`.
 *
 * The provider depends only on `MemoryListingService` (cross-module via
 * the `forwardRef` cycle resolved in M2), so the tests instantiate it
 * directly with a `vi.fn()` mock — same pattern used by
 * `memory-listing.service.spec.ts`, `recent-task-summary.provider.spec.ts`,
 * and the controller specs that inject `MemoryListingService` directly.
 *
 * Coverage:
 *   (a) `canProvide` returns false when the listing service reports
 *       zero preference segments.
 *   (b) `canProvide` returns true when at least one preference segment
 *       exists.
 *   (c) `getContext` caps the rendered block at ten segments even when
 *       the listing service returns twelve fixtures.
 *   (d) `cacheTtlSeconds` is `1800` (asserted as a constant on the
 *       provider instance — same pattern as the module-level contract
 *       test in `built-in-memory-context-providers.module.spec.ts`).
 */
describe('UserPreferenceEchoProvider', () => {
  const listSegments = vi.fn();

  let provider: UserPreferenceEchoProvider;

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
      entity_type: 'User',
      entity_id: 'scope-1',
      content: 'prefers concise answers',
      memory_type: 'preference',
      version: 1,
      metadata: null,
      created_at: '2026-05-16T00:00:00.000Z',
      updated_at: '2026-05-16T00:00:00.000Z',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new UserPreferenceEchoProvider({
      listSegments,
    } as unknown as MemoryListingService);
  });

  it('returns false from canProvide when MemoryListingService reports zero preference segments', async () => {
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
      entityType: 'User',
      entityId: 'scope-1',
      memoryType: 'preference',
      limit: 1,
      offset: 0,
    });
  });

  it('returns false from canProvide when scopeId is null without calling MemoryListingService', async () => {
    const session = buildSession({ scopeId: null });

    const result = await provider.canProvide(session);

    expect(result).toBe(false);
    expect(listSegments).not.toHaveBeenCalled();
  });

  it('returns true from canProvide when at least one preference segment exists', async () => {
    const session = buildSession({ scopeId: 'scope-1' });
    listSegments.mockResolvedValue({
      items: [
        buildSegment({
          content: 'prefers concise answers',
          created_at: '2026-05-20T12:00:00.000Z',
        }),
      ],
      total: 1,
      limit: 1,
      offset: 0,
    });

    const result = await provider.canProvide(session);

    expect(result).toBe(true);
    expect(listSegments).toHaveBeenCalledTimes(1);
    expect(listSegments).toHaveBeenCalledWith({
      entityType: 'User',
      entityId: 'scope-1',
      memoryType: 'preference',
      limit: 1,
      offset: 0,
    });
  });

  it('caps the rendered block at 10 segments when MemoryListingService returns 12', async () => {
    const session = buildSession({ scopeId: 'scope-1' });

    // Twelve unsorted fixtures so we can assert the provider sorts and
    // caps independently of the order returned by the listing service.
    const unsorted = [
      buildSegment({
        id: 'seg-1',
        created_at: '2026-05-01T00:00:00.000Z',
        content: 'one',
      }),
      buildSegment({
        id: 'seg-2',
        created_at: '2026-05-05T00:00:00.000Z',
        content: 'two',
      }),
      buildSegment({
        id: 'seg-3',
        created_at: '2026-05-10T00:00:00.000Z',
        content: 'three',
      }),
      buildSegment({
        id: 'seg-4',
        created_at: '2026-05-15T00:00:00.000Z',
        content: 'four',
      }),
      buildSegment({
        id: 'seg-5',
        created_at: '2026-05-20T00:00:00.000Z',
        content: 'five',
      }),
      buildSegment({
        id: 'seg-6',
        created_at: '2026-05-25T00:00:00.000Z',
        content: 'six',
      }),
      buildSegment({
        id: 'seg-7',
        created_at: '2026-05-30T00:00:00.000Z',
        content: 'seven',
      }),
      buildSegment({
        id: 'seg-8',
        created_at: '2026-06-01T00:00:00.000Z',
        content: 'eight',
      }),
      buildSegment({
        id: 'seg-9',
        created_at: '2026-06-05T00:00:00.000Z',
        content: 'nine',
      }),
      buildSegment({
        id: 'seg-10',
        created_at: '2026-06-10T00:00:00.000Z',
        content: 'ten',
      }),
      buildSegment({
        id: 'seg-11',
        created_at: '2026-06-15T00:00:00.000Z',
        content: 'eleven',
      }),
      buildSegment({
        id: 'seg-12',
        created_at: '2026-06-20T00:00:00.000Z',
        content: 'twelve',
      }),
    ];

    listSegments.mockResolvedValueOnce({
      items: unsorted,
      total: 12,
      limit: 10,
      offset: 0,
    });

    const block = await provider.getContext(session);

    // Exactly ten bullets rendered, regardless of the twelve fixtures.
    const bulletMatches = block.content.match(/^- /gm) ?? [];
    expect(bulletMatches).toHaveLength(10);

    // The newest ten by created_at must be the ones rendered, in DESC
    // order. The two oldest segments (one/two) must NOT appear.
    expect(block.content).toContain('- 2026-06-20T00:00:00.000Z: twelve');
    expect(block.content).toContain('- 2026-06-15T00:00:00.000Z: eleven');
    expect(block.content).toContain('- 2026-06-10T00:00:00.000Z: ten');
    expect(block.content).toContain('- 2026-06-05T00:00:00.000Z: nine');
    expect(block.content).toContain('- 2026-06-01T00:00:00.000Z: eight');
    expect(block.content).toContain('- 2026-05-30T00:00:00.000Z: seven');
    expect(block.content).toContain('- 2026-05-25T00:00:00.000Z: six');
    expect(block.content).toContain('- 2026-05-20T00:00:00.000Z: five');
    expect(block.content).toContain('- 2026-05-15T00:00:00.000Z: four');
    expect(block.content).toContain('- 2026-05-10T00:00:00.000Z: three');
    expect(block.content).not.toContain('two');
    expect(block.content).not.toContain('one');

    // Newest segment appears before older ones — confirms DESC sort.
    const twelveIndex = block.content.indexOf('twelve');
    const threeIndex = block.content.indexOf('three');
    expect(twelveIndex).toBeGreaterThan(-1);
    expect(threeIndex).toBeGreaterThan(-1);
    expect(twelveIndex).toBeLessThan(threeIndex);

    expect(listSegments).toHaveBeenCalledWith({
      entityType: 'User',
      entityId: 'scope-1',
      memoryType: 'preference',
      limit: 10,
      offset: 0,
    });

    expect(block.title).toBe('User Preferences');
    expect(block.priority).toBe(220);
    expect(block.content).toContain('## User Preferences');
    expect(block.metadata).toEqual(
      expect.objectContaining({
        source: 'user-preference-echo',
        provider: 'user-preference-echo',
        cacheTtlSeconds: 1800,
        segmentCount: 10,
      }),
    );
  });

  it('exposes cacheTtlSeconds=1800 on the provider instance (long-lived preference contract)', () => {
    expect(provider.cacheTtlSeconds).toBe(1800);
  });
});
