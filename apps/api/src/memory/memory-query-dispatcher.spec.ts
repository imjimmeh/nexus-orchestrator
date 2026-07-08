import { describe, expect, it, vi } from 'vitest';
import type { IMemorySegment } from '@nexus/core';
import { loadMemorySegmentsByPlanner } from './memory-query-dispatcher';
import type { MemoryManagerService } from './memory-manager.service';

function buildSegment(overrides: Partial<IMemorySegment> = {}): IMemorySegment {
  return {
    id: 'segment-1',
    entity_type: 'User',
    entity_id: 'user-1',
    memory_type: 'fact',
    content: 'dispatcher coverage segment',
    version: 1,
    metadata_json: { source: 'dispatcher-test' },
    created_at: new Date('2026-05-16T00:00:00.000Z'),
    updated_at: new Date('2026-05-16T00:00:00.000Z'),
    ...overrides,
  };
}

function buildMemoryManagerMock(): {
  memoryManager: MemoryManagerService;
  searchMemory: ReturnType<typeof vi.fn>;
  getMemorySegments: ReturnType<typeof vi.fn>;
  searchMemoryByType: ReturnType<typeof vi.fn>;
  getMemorySegmentsByType: ReturnType<typeof vi.fn>;
} {
  const searchMemory = vi.fn().mockResolvedValue([buildSegment()]);
  const getMemorySegments = vi.fn().mockResolvedValue([buildSegment()]);
  const searchMemoryByType = vi.fn().mockResolvedValue([buildSegment()]);
  const getMemorySegmentsByType = vi.fn().mockResolvedValue([buildSegment()]);

  const memoryManager = {
    searchMemory,
    getMemorySegments,
    searchMemoryByType,
    getMemorySegmentsByType,
  } as unknown as MemoryManagerService;

  return {
    memoryManager,
    searchMemory,
    getMemorySegments,
    searchMemoryByType,
    getMemorySegmentsByType,
  };
}

describe('MemoryQueryDispatcher', () => {
  it('forwards entityId+query to MemoryManagerService.searchMemory with the trimmed query', async () => {
    const {
      memoryManager,
      searchMemory,
      getMemorySegments,
      searchMemoryByType,
      getMemorySegmentsByType,
    } = buildMemoryManagerMock();

    const result = await loadMemorySegmentsByPlanner(memoryManager, {
      entityType: 'User',
      entityId: 'user-1',
      query: '  hello world  ',
    });

    expect(result).toHaveLength(1);
    expect(searchMemory).toHaveBeenCalledTimes(1);
    expect(searchMemory).toHaveBeenCalledWith('User', 'user-1', 'hello world');
    expect(getMemorySegments).not.toHaveBeenCalled();
    expect(searchMemoryByType).not.toHaveBeenCalled();
    expect(getMemorySegmentsByType).not.toHaveBeenCalled();
  });

  it('forwards entityId+null query to MemoryManagerService.getMemorySegments with the memory_type filter', async () => {
    const {
      memoryManager,
      searchMemory,
      getMemorySegments,
      searchMemoryByType,
      getMemorySegmentsByType,
    } = buildMemoryManagerMock();

    const result = await loadMemorySegmentsByPlanner(memoryManager, {
      entityType: 'User',
      entityId: 'user-1',
      query: null,
      memoryType: 'fact',
    });

    expect(result).toHaveLength(1);
    expect(getMemorySegments).toHaveBeenCalledTimes(1);
    expect(getMemorySegments).toHaveBeenCalledWith('User', 'user-1', {
      memory_type: 'fact',
    });
    expect(searchMemory).not.toHaveBeenCalled();
    expect(searchMemoryByType).not.toHaveBeenCalled();
    expect(getMemorySegmentsByType).not.toHaveBeenCalled();
  });

  it('forwards no entityId+query to MemoryManagerService.searchMemoryByType', async () => {
    const {
      memoryManager,
      searchMemory,
      getMemorySegments,
      searchMemoryByType,
      getMemorySegmentsByType,
    } = buildMemoryManagerMock();

    await loadMemorySegmentsByPlanner(memoryManager, {
      entityType: 'User',
      query: 'foo',
      memoryType: 'preference',
    });

    expect(searchMemoryByType).toHaveBeenCalledTimes(1);
    expect(searchMemoryByType).toHaveBeenCalledWith('User', 'foo', {
      memory_type: 'preference',
    });
    expect(searchMemory).not.toHaveBeenCalled();
    expect(getMemorySegments).not.toHaveBeenCalled();
    expect(getMemorySegmentsByType).not.toHaveBeenCalled();
  });

  it('forwards no entityId+no query to MemoryManagerService.getMemorySegmentsByType', async () => {
    const {
      memoryManager,
      searchMemory,
      getMemorySegments,
      searchMemoryByType,
      getMemorySegmentsByType,
    } = buildMemoryManagerMock();

    await loadMemorySegmentsByPlanner(memoryManager, {
      entityType: 'User',
    });

    expect(getMemorySegmentsByType).toHaveBeenCalledTimes(1);
    expect(getMemorySegmentsByType).toHaveBeenCalledWith('User', {
      memory_type: undefined,
    });
    expect(searchMemory).not.toHaveBeenCalled();
    expect(getMemorySegments).not.toHaveBeenCalled();
    expect(searchMemoryByType).not.toHaveBeenCalled();
  });

  it('returns the segments produced by the matched manager method (no extra wrapping)', async () => {
    const segments = [
      buildSegment({ id: 'segment-A' }),
      buildSegment({ id: 'segment-B' }),
    ];
    const searchMemory = vi.fn().mockResolvedValue(segments);
    const memoryManager = { searchMemory } as unknown as MemoryManagerService;

    const result = await loadMemorySegmentsByPlanner(memoryManager, {
      entityType: 'User',
      entityId: 'user-1',
      query: 'foo',
    });

    expect(result).toBe(segments);
    expect(result.map((segment) => segment.id)).toEqual([
      'segment-A',
      'segment-B',
    ]);
  });
});
