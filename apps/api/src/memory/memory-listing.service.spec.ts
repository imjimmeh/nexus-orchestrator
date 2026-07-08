import { describe, expect, it, vi } from 'vitest';
import type { IMemorySegment } from '@nexus/core';
import { MemoryListingService } from './memory-listing.service';
import type { MemoryManagerService } from './memory-manager.service';

function buildSegment(overrides: Partial<IMemorySegment> = {}): IMemorySegment {
  return {
    id: 'segment-1',
    entity_type: 'User',
    entity_id: 'user-1',
    memory_type: 'fact',
    content: 'preference content',
    version: 1,
    metadata_json: { source: 'chat' },
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
  const searchMemory = vi.fn().mockResolvedValue([]);
  const getMemorySegments = vi.fn().mockResolvedValue([]);
  const searchMemoryByType = vi.fn().mockResolvedValue([]);
  const getMemorySegmentsByType = vi.fn().mockResolvedValue([]);

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

describe('MemoryListingService', () => {
  it('projects metadata_json as metadata on each segment item', async () => {
    const memoryManager = {
      getMemorySegments: vi.fn().mockResolvedValue([buildSegment()]),
    } as unknown as MemoryManagerService;

    const service = new MemoryListingService(memoryManager);

    const result = await service.listSegments({
      entityType: 'User',
      entityId: 'user-1',
      limit: 25,
      offset: 0,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(
      expect.objectContaining({
        id: 'segment-1',
        entity_type: 'User',
        entity_id: 'user-1',
        memory_type: 'fact',
        metadata: { source: 'chat' },
        created_at: '2026-05-16T00:00:00.000Z',
        updated_at: '2026-05-16T00:00:00.000Z',
      }),
    );
  });

  it('returns null metadata when the segment has no metadata_json', async () => {
    const memoryManager = {
      getMemorySegments: vi
        .fn()
        .mockResolvedValue([buildSegment({ metadata_json: null })]),
    } as unknown as MemoryManagerService;

    const service = new MemoryListingService(memoryManager);

    const result = await service.listSegments({
      entityType: 'User',
      entityId: 'user-1',
      limit: 25,
      offset: 0,
    });

    expect(result.items[0].metadata).toBeNull();
  });
});

describe('MemoryListingService — loadSegments dispatch contract', () => {
  it('routes entityId+query to MemoryManagerService.searchMemory', async () => {
    const {
      memoryManager,
      searchMemory,
      getMemorySegments,
      searchMemoryByType,
      getMemorySegmentsByType,
    } = buildMemoryManagerMock();
    const service = new MemoryListingService(memoryManager);

    await service.listSegments({
      entityType: 'User',
      entityId: 'user-1',
      query: '  hello world  ',
      limit: 25,
      offset: 0,
    });

    expect(searchMemory).toHaveBeenCalledTimes(1);
    expect(searchMemory).toHaveBeenCalledWith('User', 'user-1', 'hello world');
    expect(getMemorySegments).not.toHaveBeenCalled();
    expect(searchMemoryByType).not.toHaveBeenCalled();
    expect(getMemorySegmentsByType).not.toHaveBeenCalled();
  });

  it('routes entityId+no query to MemoryManagerService.getMemorySegments', async () => {
    const {
      memoryManager,
      searchMemory,
      getMemorySegments,
      searchMemoryByType,
      getMemorySegmentsByType,
    } = buildMemoryManagerMock();
    const service = new MemoryListingService(memoryManager);

    await service.listSegments({
      entityType: 'User',
      entityId: 'user-1',
      memoryType: 'fact',
      limit: 25,
      offset: 0,
    });

    expect(getMemorySegments).toHaveBeenCalledTimes(1);
    expect(getMemorySegments).toHaveBeenCalledWith('User', 'user-1', {
      memory_type: 'fact',
    });
    expect(searchMemory).not.toHaveBeenCalled();
    expect(searchMemoryByType).not.toHaveBeenCalled();
    expect(getMemorySegmentsByType).not.toHaveBeenCalled();
  });

  it('routes no entityId+query to MemoryManagerService.searchMemoryByType', async () => {
    const {
      memoryManager,
      searchMemory,
      getMemorySegments,
      searchMemoryByType,
      getMemorySegmentsByType,
    } = buildMemoryManagerMock();
    const service = new MemoryListingService(memoryManager);

    await service.listSegments({
      entityType: 'User',
      query: 'hello',
      memoryType: 'fact',
      limit: 25,
      offset: 0,
    });

    expect(searchMemoryByType).toHaveBeenCalledTimes(1);
    expect(searchMemoryByType).toHaveBeenCalledWith('User', 'hello', {
      memory_type: 'fact',
    });
    expect(searchMemory).not.toHaveBeenCalled();
    expect(getMemorySegments).not.toHaveBeenCalled();
    expect(getMemorySegmentsByType).not.toHaveBeenCalled();
  });
});
