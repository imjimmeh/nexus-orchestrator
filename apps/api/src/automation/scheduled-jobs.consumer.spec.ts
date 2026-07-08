import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from 'bullmq';
import type { SystemSettingsService } from '../settings/system-settings.service';
import type { ScheduledJobsService } from './scheduled-jobs.service';
import { ScheduledJobsConsumer } from './scheduled-jobs.consumer';
import { SCHEDULED_JOBS_POLL_TICK_JOB } from './scheduled-jobs.constants';

describe('ScheduledJobsConsumer', () => {
  const settingsGetMock = vi.fn();
  const processDueSchedulesMock = vi.fn();

  const settings = {
    get: settingsGetMock,
  } as unknown as SystemSettingsService;

  const scheduledJobsService = {
    processDueSchedules: processDueSchedulesMock,
  } as unknown as ScheduledJobsService;

  let consumer: ScheduledJobsConsumer;

  beforeEach(() => {
    vi.clearAllMocks();
    settingsGetMock.mockImplementation(
      async (_key: string, defaultValue: unknown) => defaultValue,
    );
    processDueSchedulesMock.mockResolvedValue({
      scanned: 3,
      started: 2,
      skipped: 1,
    });

    consumer = new ScheduledJobsConsumer(settings, scheduledJobsService);
  });

  it('ignores unknown queue jobs', async () => {
    const result = await consumer.process({
      name: 'unexpected-job',
      data: {},
    });

    expect(result).toBeNull();
    expect(processDueSchedulesMock).not.toHaveBeenCalled();
  });

  it('returns empty metrics when scheduled jobs are disabled', async () => {
    settingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'scheduled_jobs_enabled') {
        return false;
      }
      return undefined;
    });

    const result = await consumer.process({
      name: SCHEDULED_JOBS_POLL_TICK_JOB,
      data: {},
    });

    expect(result).toEqual({
      scanned: 0,
      started: 0,
      skipped: 0,
    });
    expect(processDueSchedulesMock).not.toHaveBeenCalled();
  });

  it('falls back to default batch size for invalid configuration', async () => {
    settingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'scheduled_jobs_enabled') {
        return true;
      }
      if (key === 'scheduled_jobs_poll_batch_size') {
        return 0;
      }
      return undefined;
    });

    await consumer.process({
      name: SCHEDULED_JOBS_POLL_TICK_JOB,
      data: {},
    });

    expect(processDueSchedulesMock).toHaveBeenCalledWith(
      expect.objectContaining({ batchSize: 50 }),
    );
  });

  it('passes configured batch size when valid', async () => {
    settingsGetMock.mockImplementation(async (key: string) => {
      if (key === 'scheduled_jobs_enabled') {
        return true;
      }
      if (key === 'scheduled_jobs_poll_batch_size') {
        return 12;
      }
      return undefined;
    });

    const result = await consumer.process({
      name: SCHEDULED_JOBS_POLL_TICK_JOB,
      data: {},
    });

    expect(processDueSchedulesMock).toHaveBeenCalledWith(
      expect.objectContaining({ batchSize: 12 }),
    );
    expect(result).toEqual({
      scanned: 3,
      started: 2,
      skipped: 1,
    });
  });
});
