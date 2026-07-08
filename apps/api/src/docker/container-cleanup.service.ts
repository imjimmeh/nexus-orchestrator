import { Logger, OnModuleInit, Inject } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { ModuleRef } from '@nestjs/core';
import { Queue, Job } from 'bullmq';
import { ContainerOrchestratorService } from './container-orchestrator.service';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../workflow/kernel/interfaces/workflow-kernel.ports';
import Docker from 'dockerode';
import { isTerminalWorkflowRunStatus } from '@nexus/core';
import { DOCKER_CLIENT } from './docker.constants';
import { CompositeImageBuilderService } from '../workflow/workflow-runtime-toolchains/composite-image-builder.service';

/**
 * Max age of a managed composite toolchain image before the periodic cleanup
 * job removes it. Mirrors the 24h stale-container window below but kept as a
 * separate, longer constant since rebuilding a composite image is far more
 * expensive than restarting a container.
 */
const COMPOSITE_IMAGE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Cron pattern for the periodic managed-container reaper. Runs every 10 minutes
 * rather than hourly: a leaked HEAVY container holds a 4GB RAM+swap slot, and on
 * an over-committed VM even one stranded slot pushes concurrent harness
 * containers into global OOM (a new kernel then fails to start with ENOMEM). A
 * sub-hourly sweep bounds how long such a slot lingers when the in-process
 * per-step teardown is bypassed (durable/telemetry completion or a swallowed
 * removeContainer failure).
 */
const CONTAINER_CLEANUP_CRON = '*/10 * * * *';

@Processor('container-cleanup')
export class ContainerCleanupService
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(ContainerCleanupService.name);

  constructor(
    @InjectQueue('container-cleanup') private readonly cleanupQueue: Queue,
    private readonly orchestrator: ContainerOrchestratorService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
    private readonly moduleRef: ModuleRef,
  ) {
    super();
  }

  /**
   * Resolved lazily (rather than via constructor injection) so `DockerModule`
   * does not need a static import of `WorkflowKernelModule` — that edge would
   * close a module cycle (WorkflowKernelModule already imports
   * WorkflowCoreModule via forwardRef, and WorkflowCoreModule imports
   * DockerModule). Mirrors the `compositeImageBuilder` getter below; see
   * `WorkflowRuntimeToolchainsModule`'s class doc and
   * `apps/api/CIRCULAR_BASELINE.md`.
   */
  private get workflowRunRepository(): IWorkflowRunRepository {
    return this.moduleRef.get<IWorkflowRunRepository>(
      WORKFLOW_RUN_REPOSITORY_PORT,
      { strict: false },
    );
  }

  /**
   * Resolved lazily (rather than via constructor injection) so `DockerModule`
   * does not need a static import of `WorkflowRuntimeToolchainsModule` —
   * that edge would close a module cycle (WorkflowRuntimeToolchainsModule
   * already imports DockerModule for `DOCKER_CLIENT`). See
   * `WorkflowRuntimeToolchainsModule`'s class doc and
   * `apps/api/CIRCULAR_BASELINE.md`.
   */
  private get compositeImageBuilder(): CompositeImageBuilderService {
    const builder = this.moduleRef.get(CompositeImageBuilderService, {
      strict: false,
    });
    if (!builder) {
      throw new Error(
        'CompositeImageBuilderService resolved to null — WorkflowRuntimeToolchainsModule must be imported in AppModule',
      );
    }
    return builder;
  }

  async onModuleInit() {
    // Reap immediately on boot. An API restart bypasses the in-process per-step
    // teardown `finally`, stranding managed containers whose runs have gone
    // terminal until the next scheduled sweep — on an over-committed VM those
    // orphaned 4GB slots are what tip concurrent harness containers into global
    // OOM. Running once at startup reclaims them right away.
    await this.cleanupQueue.add('startup-cleanup', {});

    // (Re)register the periodic sweep. Remove any previously-registered
    // repeatable first so a changed interval across deploys (e.g. the former
    // hourly schedule) does not leave a stale sweep running alongside the new
    // one — BullMQ keys repeatables by pattern, so a changed pattern would
    // otherwise accumulate schedules rather than replace them.
    const existing = await this.cleanupQueue.getRepeatableJobs();
    await Promise.all(
      existing.map((repeatable) =>
        this.cleanupQueue.removeRepeatableByKey(repeatable.key),
      ),
    );
    await this.cleanupQueue.add(
      'periodic-cleanup',
      {},
      {
        repeat: {
          pattern: CONTAINER_CLEANUP_CRON,
        },
      },
    );
    this.logger.log(
      `ContainerCleanupService initialized (startup reap + periodic sweep ${CONTAINER_CLEANUP_CRON})`,
    );
  }

  async process(job: Job<Record<string, unknown>, unknown>): Promise<unknown> {
    this.logger.log(`Starting container cleanup job: ${job.name}`);

    const containers = await this.docker.listContainers({ all: true });

    for (const containerInfo of containers) {
      const labels = containerInfo.Labels;

      // Only cleanup containers managed by Nexus
      if (labels['nexus.managed'] !== 'true') {
        continue;
      }

      const workflowRunId = labels['nexus.workflow_run_id'];
      const containerId = containerInfo.Id;

      // 1. Orphaned Containers (no workflow run ID or workflow run doesn't exist)
      if (workflowRunId) {
        const run = await this.workflowRunRepository.findById(workflowRunId);
        if (!run) {
          this.logger.warn(
            `Cleaning up orphaned container ${containerId} (Run ${workflowRunId} not found)`,
          );
          await this.orchestrator.removeContainer(containerId);
          continue;
        }

        // 1b. Terminal-run Containers. A managed container outlives its run
        // when the per-step cleanup `finally` is bypassed (API restart mid-step,
        // durable/telemetry completion, or a swallowed removeContainer failure).
        // Such a container keeps the `running` Docker state and so still counts
        // against the managed-container cap. Reaping it as soon as its run is
        // terminal — rather than waiting for the 24h stale rule below — is the
        // authoritative cleanup that does not depend on in-process promises.
        if (isTerminalWorkflowRunStatus(run.status)) {
          this.logger.warn(
            `Cleaning up container ${containerId} for terminal run ${workflowRunId} (status ${run.status})`,
          );
          await this.orchestrator.removeContainer(containerId);
          continue;
        }
      } else {
        this.logger.warn(
          `Cleaning up managed container ${containerId} with no workflow run label`,
        );
        await this.orchestrator.removeContainer(containerId);
        continue;
      }

      // 2. Stale Containers (running > 24 hours)
      const createdDate = new Date(containerInfo.Created * 1000);
      const now = new Date();
      const diffHours =
        (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60);

      if (diffHours > 24) {
        this.logger.warn(
          `Cleaning up stale container ${containerId} (Created ${createdDate.toISOString()})`,
        );
        await this.orchestrator.removeContainer(containerId);
      }
    }

    // 3. Prune unused volumes. Exclude nexus.cache=true volumes: these are
    // the package/OS cache volumes provisioned by PackageCacheVolumeService,
    // which are only attached to a container while a step/subagent is
    // actively running. Between runs they are legitimately unattached, so an
    // unfiltered prune would delete them hourly and silently defeat the
    // caching feature (see package-cache-volume.service.ts). The Docker
    // Engine API's volume-prune `label` filter accepts a negated form —
    // `label!=<key>=<value>` — encoded as a `<key>!=<value>` string inside
    // the `label` filter array, which excludes matching volumes from prune.
    try {
      await this.docker.pruneVolumes({
        filters: { label: ['nexus.cache!=true'] },
      });
      this.logger.log('Pruned unused Docker volumes (excluding cache volumes)');
    } catch (e) {
      const error = e as Error;
      this.logger.error(`Failed to prune volumes: ${error.message}`);
    }

    // 4. GC stale composite toolchain images
    try {
      await this.compositeImageBuilder.collectGarbage(
        COMPOSITE_IMAGE_MAX_AGE_MS,
      );
    } catch (e) {
      const error = e as Error;
      this.logger.error(
        `Failed to garbage-collect composite images: ${error.message}`,
      );
    }

    return { cleaned: true };
  }
}
