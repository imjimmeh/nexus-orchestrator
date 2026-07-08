import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatMemoryAdminController } from './chat-memory-admin.controller';
import type { ChatMemoryAdminService } from './chat-memory-admin.service';

describe('ChatMemoryAdminController', () => {
  const listSegments = vi.fn();
  const getObservability = vi.fn();

  let controller: ChatMemoryAdminController;

  beforeEach(() => {
    vi.clearAllMocks();

    controller = new ChatMemoryAdminController({
      listSegments,
      getObservability,
    } as unknown as ChatMemoryAdminService);
  });

  it('lists chat memory segments', async () => {
    listSegments.mockResolvedValue({
      source: 'profile',
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });

    const result = await controller.listSegments({
      source: 'profile',
      profile_id: 'profile-1',
      chat_session_id: 'session-1',
      memory_type: 'fact',
      query: 'deterministic',
      include_archived: true,
      only_undistilled: false,
      limit: 25,
      offset: 0,
    });

    expect(listSegments).toHaveBeenCalledWith({
      source: 'profile',
      profileId: 'profile-1',
      chatSessionId: 'session-1',
      memoryType: 'fact',
      query: 'deterministic',
      includeArchived: true,
      onlyUndistilled: false,
      limit: 25,
      offset: 0,
    });

    expect(result).toEqual({
      success: true,
      data: {
        source: 'profile',
        items: [],
        total: 0,
        limit: 25,
        offset: 0,
      },
    });
  });

  it('returns observability summary', async () => {
    getObservability.mockResolvedValue({
      counts: {
        jobs: {
          pending: 1,
          running: 0,
          completed: 10,
          failed: 2,
        },
        events: {
          promoted: 8,
          updated: 4,
        },
      },
      recent_failed_jobs: [],
      recent_events: [],
    });

    const result = await controller.getObservability({
      jobs_limit: 30,
      events_limit: 15,
    });

    expect(getObservability).toHaveBeenCalledWith({
      recentJobsLimit: 30,
      recentEventsLimit: 15,
    });
    expect(result.success).toBe(true);
    expect(result.data.counts.jobs.failed).toBe(2);
  });
});
