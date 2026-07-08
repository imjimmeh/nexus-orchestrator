import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Job, Queue } from 'bullmq';
import type { ModuleRef } from '@nestjs/core';
import type Docker from 'dockerode';
import { WorkflowStatus } from '@nexus/core';
import { ContainerCleanupService } from './container-cleanup.service';
import type { ContainerOrchestratorService } from './container-orchestrator.service';
import type { IWorkflowRunRepository } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import { CompositeImageBuilderService } from '../workflow/workflow-runtime-toolchains/composite-image-builder.service';

type ListContainersResult = Array<{
  Id: string;
  Created: number;
  Labels: Record<string, string>;
}>;

const NOW_SECONDS = Math.floor(Date.UTC(2026, 5, 30, 12, 0, 0) / 1000);
const ONE_HOUR_SECONDS = 60 * 60;

function buildManagedContainer(
  overrides: Partial<ListContainersResult[number]> = {},
): ListContainersResult[number] {
  return {
    Id: 'container-abc',
    // Recently created (1 hour ago) so the >24h stale rule never applies.
    Created: NOW_SECONDS - ONE_HOUR_SECONDS,
    Labels: {
      'nexus.managed': 'true',
      'nexus.workflow_run_id': 'run-1',
    },
    ...overrides,
  };
}

describe('ContainerCleanupService', () => {
  let docker: {
    listContainers: ReturnType<typeof vi.fn>;
    pruneVolumes: ReturnType<typeof vi.fn>;
  };
  let orchestrator: { removeContainer: ReturnType<typeof vi.fn> };
  let runRepo: { findById: ReturnType<typeof vi.fn> };
  let compositeImageBuilder: { collectGarbage: ReturnType<typeof vi.fn> };
  let moduleRef: { get: ReturnType<typeof vi.fn> };
  let service: ContainerCleanupService;

  const periodicJob = { name: 'periodic-cleanup' } as Job<
    Record<string, unknown>,
    unknown
  >;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW_SECONDS * 1000));

    docker = {
      listContainers: vi.fn(),
      pruneVolumes: vi.fn().mockResolvedValue(undefined),
    };
    orchestrator = { removeContainer: vi.fn().mockResolvedValue(undefined) };
    runRepo = { findById: vi.fn() };
    compositeImageBuilder = {
      collectGarbage: vi.fn().mockResolvedValue(undefined),
    };
    moduleRef = {
      get: vi.fn().mockImplementation((token: unknown) => {
        if (token === WORKFLOW_RUN_REPOSITORY_PORT) {
          return runRepo;
        }
        if (token === CompositeImageBuilderService) {
          return compositeImageBuilder;
        }
        return null;
      }),
    };

    service = new ContainerCleanupService(
      {} as unknown as Queue,
      orchestrator as unknown as ContainerOrchestratorService,
      docker as unknown as Docker,
      moduleRef as unknown as ModuleRef,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is registered as a BullMQ processor bound to the container-cleanup queue', () => {
    // A WorkerHost subclass only has its `process()` invoked when decorated
    // with `@Processor(queueName)`. With `@Injectable()` alone the worker is
    // never bound and enqueued cleanup jobs pile up in `wait`, never reaped —
    // which stranded managed containers and drove the host into OOM.
    const metadata = Reflect.getMetadata(
      'bullmq:processor_metadata',
      ContainerCleanupService,
    );

    expect(metadata).toEqual({ name: 'container-cleanup' });
  });

  it('removes a recently-created managed container whose run is in a terminal state', async () => {
    docker.listContainers.mockResolvedValue([buildManagedContainer()]);
    runRepo.findById.mockResolvedValue({ status: WorkflowStatus.COMPLETED });

    await service.process(periodicJob);

    expect(orchestrator.removeContainer).toHaveBeenCalledWith('container-abc');
  });

  it('does not remove a recently-created managed container whose run is still RUNNING', async () => {
    docker.listContainers.mockResolvedValue([buildManagedContainer()]);
    runRepo.findById.mockResolvedValue({ status: WorkflowStatus.RUNNING });

    await service.process(periodicJob);

    expect(orchestrator.removeContainer).not.toHaveBeenCalled();
  });

  it('still removes orphaned managed containers whose run no longer exists', async () => {
    docker.listContainers.mockResolvedValue([buildManagedContainer()]);
    runRepo.findById.mockResolvedValue(null);

    await service.process(periodicJob);

    expect(orchestrator.removeContainer).toHaveBeenCalledWith('container-abc');
  });

  it('ignores containers not managed by Nexus', async () => {
    docker.listContainers.mockResolvedValue([
      buildManagedContainer({ Labels: { 'nexus.managed': 'false' } }),
    ]);

    await service.process(periodicJob);

    expect(runRepo.findById).not.toHaveBeenCalled();
    expect(orchestrator.removeContainer).not.toHaveBeenCalled();
  });

  it('garbage-collects stale composite toolchain images with a 7-day max age', async () => {
    docker.listContainers.mockResolvedValue([]);

    await service.process(periodicJob);

    expect(moduleRef.get).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ strict: false }),
    );
    expect(compositeImageBuilder.collectGarbage).toHaveBeenCalledWith(
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it('does not let a composite image GC failure abort the cleanup job', async () => {
    docker.listContainers.mockResolvedValue([]);
    compositeImageBuilder.collectGarbage.mockRejectedValue(
      new Error('docker prune failed'),
    );

    await expect(service.process(periodicJob)).resolves.toEqual({
      cleaned: true,
    });
  });

  it('does not let a missing CompositeImageBuilderService abort the cleanup job', async () => {
    docker.listContainers.mockResolvedValue([]);
    moduleRef.get.mockReturnValue(null);

    await expect(service.process(periodicJob)).resolves.toEqual({
      cleaned: true,
    });
  });

  it('prunes volumes with a filter that excludes nexus.cache=true labeled volumes', async () => {
    docker.listContainers.mockResolvedValue([]);

    await service.process(periodicJob);

    expect(docker.pruneVolumes).toHaveBeenCalledWith({
      filters: { label: ['nexus.cache!=true'] },
    });
  });

  describe('onModuleInit', () => {
    let queue: {
      add: ReturnType<typeof vi.fn>;
      getRepeatableJobs: ReturnType<typeof vi.fn>;
      removeRepeatableByKey: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      queue = {
        add: vi.fn().mockResolvedValue(undefined),
        getRepeatableJobs: vi.fn().mockResolvedValue([]),
        removeRepeatableByKey: vi.fn().mockResolvedValue(undefined),
      };
      service = new ContainerCleanupService(
        queue as unknown as Queue,
        orchestrator as unknown as ContainerOrchestratorService,
        docker as unknown as Docker,
        moduleRef as unknown as ModuleRef,
      );
    });

    it('enqueues an immediate one-off reap on startup so an API restart does not strand terminal-run containers', async () => {
      await service.onModuleInit();

      const oneOffCalls = queue.add.mock.calls.filter(
        (call) => call[2] === undefined || !('repeat' in (call[2] ?? {})),
      );
      expect(oneOffCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('registers the periodic sweep on a sub-hourly interval', async () => {
      await service.onModuleInit();

      const repeatableCall = queue.add.mock.calls.find(
        (call) => (call[2] as { repeat?: { pattern?: string } })?.repeat,
      );
      expect(repeatableCall).toBeDefined();
      const pattern = (repeatableCall![2] as { repeat: { pattern: string } })
        .repeat.pattern;
      // Not the old hourly `0 * * * *` — must run more frequently to bound the
      // window a leaked 4GB HEAVY container holds its slot.
      expect(pattern).not.toBe('0 * * * *');
      expect(pattern).toBe('*/10 * * * *');
    });

    it('removes any pre-existing repeatable schedule before registering, so a changed interval does not leave a stale sweep running', async () => {
      queue.getRepeatableJobs.mockResolvedValue([{ key: 'stale-hourly-key' }]);

      await service.onModuleInit();

      expect(queue.removeRepeatableByKey).toHaveBeenCalledWith(
        'stale-hourly-key',
      );
    });
  });
});
