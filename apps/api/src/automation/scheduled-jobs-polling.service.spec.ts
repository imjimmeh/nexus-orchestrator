import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Queue } from 'bullmq';
import type { SystemSettingsService } from '../settings/system-settings.service';
import {
  SCHEDULED_JOBS_POLL_REPEAT_JOB_ID,
  SCHEDULED_JOBS_POLL_TICK_JOB,
} from './scheduled-jobs.constants';
import { ScheduledJobsPollingService } from './scheduled-jobs-polling.service';

describe('ScheduledJobsPollingService', () => {
  const queueAddMock = vi.fn();
  const settingsGetMock = vi.fn();

  const queue = {
    add: queueAddMock,
  } as unknown as Queue;

  const settings = {
    get: settingsGetMock,
  } as unknown as SystemSettingsService;

  let service: ScheduledJobsPollingService;

  beforeEach(() => {
    vi.clearAllMocks();
    queueAddMock.mockResolvedValue(undefined);
    settingsGetMock.mockImplementation(
      async (_key: string, defaultValue: unknown) => defaultValue,
    );

    service = new ScheduledJobsPollingService(queue, settings);
  });

  it('schedules repeatable polling job on module init when enabled', async () => {
    settingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'scheduled_jobs_enabled') {
        return true;
      }
      if (key === 'scheduled_jobs_poll_interval_seconds') {
        return 45;
      }
      return undefined;
    });

    await service.onModuleInit();

    expect(queueAddMock).toHaveBeenCalledWith(
      SCHEDULED_JOBS_POLL_TICK_JOB,
      {},
      {
        jobId: SCHEDULED_JOBS_POLL_REPEAT_JOB_ID,
        repeat: {
          every: 45_000,
        },
      },
    );
  });

  it('does not schedule polling job when disabled', async () => {
    settingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'scheduled_jobs_enabled') {
        return false;
      }
      return undefined;
    });

    await service.configurePollingSchedule();

    expect(queueAddMock).not.toHaveBeenCalled();
  });

  it('falls back to default interval when configured interval is below minimum', async () => {
    settingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'scheduled_jobs_enabled') {
        return true;
      }
      if (key === 'scheduled_jobs_poll_interval_seconds') {
        return 1;
      }
      return undefined;
    });

    await service.configurePollingSchedule();

    expect(queueAddMock).toHaveBeenCalledWith(
      SCHEDULED_JOBS_POLL_TICK_JOB,
      {},
      expect.objectContaining({
        repeat: {
          every: 30_000,
        },
      }),
    );
  });
});
