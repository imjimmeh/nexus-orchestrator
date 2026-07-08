import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SystemMemoryController } from './system-memory.controller';
import type { MemoryListingService } from './memory-listing.service';

const SYSTEM_ENTITY_TYPE = 'System';

describe('SystemMemoryController', () => {
  const listSegments = vi.fn();

  let controller: SystemMemoryController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new SystemMemoryController({
      listSegments,
    } as unknown as MemoryListingService);
  });

  it('lists system memory segments', async () => {
    listSegments.mockResolvedValue({
      items: [
        {
          id: 'seg-1',
          entity_type: SYSTEM_ENTITY_TYPE,
          entity_id: 'global',
          content: 'System config',
          memory_type: 'fact',
          version: 1,
          created_at: '2026-04-27T00:00:00.000Z',
          updated_at: '2026-04-27T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });

    const result = await controller.listSegments({
      entity_id: 'global',
      limit: 25,
      offset: 0,
    });

    expect(listSegments).toHaveBeenCalledWith({
      entityType: SYSTEM_ENTITY_TYPE,
      entityId: 'global',
      memoryType: undefined,
      query: undefined,
      limit: 25,
      offset: 0,
    });
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });
});
