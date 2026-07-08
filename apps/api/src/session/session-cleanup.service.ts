import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, WorkerHost, Processor } from '@nestjs/bullmq';
import { Queue, Job } from 'bullmq';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import {
  WORKFLOW_RUN_LOOKUP_SERVICE,
  type IWorkflowRunLookupService,
} from '../shared/interfaces/workflow-run-lookup.interface';

const SESSION_RETENTION_DAYS = 30;
const ARCHIVE_REASON_RETENTION = 'retention_30_days';
const ARCHIVE_REASON_ORPHANED = 'orphaned_workflow_run';
const CLEANUP_BATCH_SIZE = 1000;
const MEMORY_THRESHOLD_BYTES = 1 * 1024 * 1024 * 1024;

@Injectable()
@Processor('session-cleanup')
export class SessionCleanupService extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(SessionCleanupService.name);

  constructor(
    @InjectQueue('session-cleanup') private readonly cleanupQueue: Queue,
    private readonly sessionTreeRepo: PiSessionTreeRepository,
    @Inject(WORKFLOW_RUN_LOOKUP_SERVICE)
    private readonly runLookupService: IWorkflowRunLookupService,
  ) {
    super();
  }

  async onModuleInit() {
    await this.cleanupQueue.add(
      'daily-cleanup',
      {},
      {
        repeat: {
          pattern: '0 2 * * *', // Daily at 2 AM
        },
      },
    );
    this.logger.log('SessionCleanupService initialized with daily job');
  }

  async process(job: Job<Record<string, unknown>, unknown>): Promise<unknown> {
    this.logger.log(`Starting session cleanup job: ${job.name}`);

    const now = new Date();
    const retentionCutoff = new Date(
      now.getTime() - SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );

    let archivedForRetention = 0;
    let archivedOrphaned = 0;
    let scanned = 0;
    let page = 0;

    while (true) {
      this.checkMemoryPressure();

      const activeTreePage =
        await this.sessionTreeRepo.findActiveMetadataForCleanup({
          skip: page * CLEANUP_BATCH_SIZE,
          take: CLEANUP_BATCH_SIZE,
        });

      if (activeTreePage.length === 0) {
        break;
      }

      scanned += activeTreePage.length;

      const runIds = Array.from(
        new Set(
          activeTreePage
            .map((tree) => tree.workflow_run_id)
            .filter((id): id is string => !!id),
        ),
      );
      const existingRuns = await this.runLookupService.findByIds(runIds);
      const existingRunIdSet = new Set(existingRuns.map((run) => run.id));

      for (const tree of activeTreePage) {
        if (tree.created_at < retentionCutoff) {
          await this.sessionTreeRepo.archive(tree.id, ARCHIVE_REASON_RETENTION);
          archivedForRetention++;
          continue;
        }

        if (
          !tree.workflow_run_id ||
          !existingRunIdSet.has(tree.workflow_run_id)
        ) {
          await this.sessionTreeRepo.archive(tree.id, ARCHIVE_REASON_ORPHANED);
          archivedOrphaned++;
        }
      }

      page++;

      if (activeTreePage.length < CLEANUP_BATCH_SIZE) {
        break;
      }
    }

    const archivedTotal = archivedForRetention + archivedOrphaned;
    this.logger.log(
      `Session cleanup completed: archived=${archivedTotal.toString()} (retention=${archivedForRetention.toString()}, orphaned=${archivedOrphaned.toString()})`,
    );

    return {
      scanned,
      archived: archivedTotal,
      archived_for_retention: archivedForRetention,
      archived_orphaned: archivedOrphaned,
      orphaned: archivedOrphaned,
    };
  }

  private checkMemoryPressure(): void {
    const usage = process.memoryUsage();
    if (usage.heapUsed > MEMORY_THRESHOLD_BYTES) {
      throw new Error(
        `Session cleanup aborted: heap usage ${usage.heapUsed.toString()} bytes exceeds threshold ${MEMORY_THRESHOLD_BYTES.toString()} bytes`,
      );
    }
  }
}
