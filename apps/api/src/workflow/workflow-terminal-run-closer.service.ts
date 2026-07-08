import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { WorkflowContainerCleanupService } from './workflow-container-cleanup.service';
import { fetchQueueJobsForRun } from './workflow-run-queue.utils';

@Injectable()
export class WorkflowTerminalRunCloserService {
  private readonly logger = new Logger(WorkflowTerminalRunCloserService.name);
  private readonly queueScanLimit = 5000;

  constructor(
    @InjectQueue('workflow-steps') private readonly stepQueue: Queue,
    private readonly containerCleanup: WorkflowContainerCleanupService,
  ) {}

  async closeFailedRun(params: {
    workflowRunId: string;
    workflowId: string;
    failedJobId: string;
    reason: string;
  }): Promise<{ removedJobs: number; stoppedContainers: number }> {
    const [removedJobs, stoppedContainers] = await Promise.all([
      this.removeQueuedJobsForRun(params.workflowRunId),
      this.stopManagedContainersForRun(params.workflowRunId),
    ]);

    this.logger.warn(
      `Closed failed workflow run ${params.workflowRunId} (${params.workflowId}) after ${params.failedJobId}: ${params.reason}; removedJobs=${removedJobs} stoppedContainers=${stoppedContainers}`,
    );

    return { removedJobs, stoppedContainers };
  }

  private async removeQueuedJobsForRun(workflowRunId: string): Promise<number> {
    const candidateJobs = await fetchQueueJobsForRun({
      stepQueue: this.stepQueue,
      workflowRunId,
      queueScanLimit: this.queueScanLimit,
    });
    let removedCount = 0;
    for (const job of candidateJobs) {
      try {
        await job.remove();
        removedCount += 1;
      } catch (error) {
        this.logger.warn(
          `Failed to remove queued job ${job.id} for workflow run ${workflowRunId}: ${(error as Error).message}`,
        );
      }
    }
    return removedCount;
  }

  private stopManagedContainersForRun(workflowRunId: string): Promise<number> {
    return this.containerCleanup.stopManagedContainersForRun(workflowRunId);
  }
}
