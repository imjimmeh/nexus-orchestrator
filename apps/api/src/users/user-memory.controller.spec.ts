import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserMemoryController } from './user-memory.controller';
import type { MemoryListingService } from '../memory/memory-listing.service';

const USER_ENTITY_TYPE = 'User';

describe('UserMemoryController', () => {
  const listSegments = vi.fn();

  let controller: UserMemoryController;

  beforeEach(() => {
    vi.clearAllMocks();
    controller = new UserMemoryController({
      listSegments,
    } as unknown as MemoryListingService);
  });

  it('lists memory segments for a user', async () => {
    listSegments.mockResolvedValue({
      items: [
        {
          id: 'seg-1',
          entity_type: USER_ENTITY_TYPE,
          entity_id: 'user-1',
          content: 'Prefers dark mode',
          memory_type: 'preference',
          version: 1,
          created_at: '2026-04-27T00:00:00.000Z',
          updated_at: '2026-04-27T00:00:00.000Z',
        },
      ],
      total: 1,
      limit: 25,
      offset: 0,
    });

    const result = await controller.listSegments('user-1', {
      memory_type: 'preference',
      limit: 25,
      offset: 0,
    });

    expect(listSegments).toHaveBeenCalledWith({
      entityType: USER_ENTITY_TYPE,
      entityId: 'user-1',
      memoryType: 'preference',
      query: undefined,
      limit: 25,
      offset: 0,
    });
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });
});
