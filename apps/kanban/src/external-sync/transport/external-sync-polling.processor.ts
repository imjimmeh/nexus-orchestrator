import { Processor, WorkerHost, OnWorkerEvent } from "@nestjs/bullmq";
import { Job } from "bullmq";
import { Logger } from "@nestjs/common";
import { EXTERNAL_SYNC_POLLING_QUEUE } from "./external-sync-polling.queue.js";
import { SyncCoordinatorService } from "../sync-engine/sync-coordinator.service.js";

interface PollingJobData {
  connectionId: string;
  projectId: string;
}

@Processor(EXTERNAL_SYNC_POLLING_QUEUE)
export class ExternalSyncPollingProcessor extends WorkerHost {
  private readonly logger = new Logger(ExternalSyncPollingProcessor.name);

  constructor(private readonly syncCoordinator: SyncCoordinatorService) {
    super();
  }

  async process(job: Job<PollingJobData>): Promise<{ processed: number }> {
    const result = await this.syncCoordinator.sync(
      job.data.projectId,
      job.data.connectionId,
    );
    return { processed: result.processed };
  }

  @OnWorkerEvent("failed")
  onFailed(job: Job<PollingJobData>, error: Error): void {
    this.logger.error(
      `Polling job ${job.id} failed for connection ${job.data.connectionId}`,
      error.stack,
    );
  }
}
