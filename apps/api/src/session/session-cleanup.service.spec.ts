import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import type { Job } from 'bullmq';
import { getQueueToken } from '@nestjs/bullmq';
import { SessionCleanupService } from './session-cleanup.service';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import { WORKFLOW_RUN_LOOKUP_SERVICE } from '../shared/interfaces/workflow-run-lookup.interface';

describe('SessionCleanupService', () => {
  const queueMock = {
    add: vi.fn().mockResolvedValue(undefined),
  };

  const sessionTreeRepoMock = {
    findActiveMetadataForCleanup: vi.fn(),
    archive: vi.fn(),
  };

  const runLookupServiceMock = {
    findByIds: vi.fn(),
  };

  let service: SessionCleanupService;

  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();

    // Prevent the real heap from exceeding MEMORY_THRESHOLD_BYTES (1 GiB) when
    // the test suite is run after tiktoken/WASM modules have been loaded.
    // Each test that explicitly exercises the OOM path overrides this spy.
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 512 * 1024 * 1024,
    } as NodeJS.MemoryUsage);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SessionCleanupService,
        {
          provide: getQueueToken('session-cleanup'),
          useValue: queueMock,
        },
        {
          provide: PiSessionTreeRepository,
          useValue: sessionTreeRepoMock,
        },
        {
          provide: WORKFLOW_RUN_LOOKUP_SERVICE,
          useValue: runLookupServiceMock,
        },
      ],
    }).compile();

    service = module.get(SessionCleanupService);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('schedules the daily cleanup job at module init', async () => {
    await service.onModuleInit();

    expect(queueMock.add).toHaveBeenCalledWith(
      'daily-cleanup',
      {},
      {
        repeat: {
          pattern: '0 2 * * *',
        },
      },
    );
  });

  it('archives old and orphaned active sessions', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T00:00:00.000Z'));

    sessionTreeRepoMock.findActiveMetadataForCleanup.mockResolvedValue([
      {
        id: 'session-old',
        workflow_run_id: 'run-old',
        created_at: new Date('2026-02-01T00:00:00.000Z'),
      },
      {
        id: 'session-active',
        workflow_run_id: 'run-active',
        created_at: new Date('2026-04-04T00:00:00.000Z'),
      },
      {
        id: 'session-orphaned',
        workflow_run_id: 'run-missing',
        created_at: new Date('2026-04-01T00:00:00.000Z'),
      },
    ]);

    runLookupServiceMock.findByIds.mockResolvedValue([{ id: 'run-active' }]);
    sessionTreeRepoMock.archive.mockResolvedValue({ id: 'archived-session' });

    const result = await service.process({
      name: 'daily-cleanup',
    } as Job<Record<string, unknown>, unknown>);

    expect(
      sessionTreeRepoMock.findActiveMetadataForCleanup,
    ).toHaveBeenCalledWith({ skip: 0, take: 1000 });

    expect(runLookupServiceMock.findByIds).toHaveBeenCalledWith([
      'run-old',
      'run-active',
      'run-missing',
    ]);

    expect(sessionTreeRepoMock.archive).toHaveBeenNthCalledWith(
      1,
      'session-old',
      'retention_30_days',
    );
    expect(sessionTreeRepoMock.archive).toHaveBeenNthCalledWith(
      2,
      'session-orphaned',
      'orphaned_workflow_run',
    );

    expect(result).toEqual({
      scanned: 3,
      archived: 2,
      archived_for_retention: 1,
      archived_orphaned: 1,
      orphaned: 1,
    });
  });

  it('pages through active sessions in batches', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-05T00:00:00.000Z'));

    // The service stops paging when a page has fewer than CLEANUP_BATCH_SIZE
    // (1000) items. To exercise the pagination path, pages 1 and 2 must each
    // return exactly 1000 entries; page 3 returns an empty array to end the
    // loop. All sessions are recent and not orphaned so nothing is archived.
    const makeRecentSession = (id: string) => ({
      id,
      workflow_run_id: id,
      created_at: new Date('2026-04-04T00:00:00.000Z'),
    });
    const page1 = Array.from({ length: 1000 }, (_, i) =>
      makeRecentSession(`sess-p1-${i.toString()}`),
    );
    const page2 = Array.from({ length: 1000 }, (_, i) =>
      makeRecentSession(`sess-p2-${i.toString()}`),
    );
    const page1Ids = page1.map((s) => s.id);
    const page2Ids = page2.map((s) => s.id);

    sessionTreeRepoMock.findActiveMetadataForCleanup
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2)
      .mockResolvedValueOnce([]);

    runLookupServiceMock.findByIds
      .mockResolvedValueOnce(page1.map((s) => ({ id: s.workflow_run_id })))
      .mockResolvedValueOnce(page2.map((s) => ({ id: s.workflow_run_id })));
    sessionTreeRepoMock.archive.mockResolvedValue({ id: 'archived-session' });

    const result = await service.process({
      name: 'daily-cleanup',
    } as Job<Record<string, unknown>, unknown>);

    expect(
      sessionTreeRepoMock.findActiveMetadataForCleanup,
    ).toHaveBeenCalledTimes(3);
    expect(
      sessionTreeRepoMock.findActiveMetadataForCleanup,
    ).toHaveBeenNthCalledWith(1, { skip: 0, take: 1000 });
    expect(
      sessionTreeRepoMock.findActiveMetadataForCleanup,
    ).toHaveBeenNthCalledWith(2, { skip: 1000, take: 1000 });
    expect(
      sessionTreeRepoMock.findActiveMetadataForCleanup,
    ).toHaveBeenNthCalledWith(3, { skip: 2000, take: 1000 });
    expect(runLookupServiceMock.findByIds).toHaveBeenNthCalledWith(1, page1Ids);
    expect(runLookupServiceMock.findByIds).toHaveBeenNthCalledWith(2, page2Ids);
    expect(result).toEqual({
      scanned: 2000,
      archived: 0,
      archived_for_retention: 0,
      archived_orphaned: 0,
      orphaned: 0,
    });
  });

  it('aborts cleanup when memory pressure exceeds threshold', async () => {
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      heapUsed: 2 * 1024 * 1024 * 1024,
    } as NodeJS.MemoryUsage);

    await expect(
      service.process({
        name: 'daily-cleanup',
      } as Job<Record<string, unknown>, unknown>),
    ).rejects.toThrow(
      /Session cleanup aborted: heap usage \d+ bytes exceeds threshold \d+ bytes/,
    );
  });

  it('returns empty archive summary when no active sessions exist', async () => {
    sessionTreeRepoMock.findActiveMetadataForCleanup.mockResolvedValue([]);
    runLookupServiceMock.findByIds.mockResolvedValue([]);

    const result = await service.process({
      name: 'daily-cleanup',
    } as Job<Record<string, unknown>, unknown>);

    expect(result).toEqual({
      scanned: 0,
      archived: 0,
      archived_for_retention: 0,
      archived_orphaned: 0,
      orphaned: 0,
    });
    expect(sessionTreeRepoMock.archive).not.toHaveBeenCalled();
  });
});
