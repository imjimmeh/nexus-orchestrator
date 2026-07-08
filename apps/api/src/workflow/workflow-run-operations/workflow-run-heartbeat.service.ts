import { Inject, Injectable, Logger } from '@nestjs/common';
import { WORKFLOW_RUN_REPOSITORY_PORT } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowRunRepository } from '../kernel/interfaces/workflow-kernel.ports';
import { shouldEmitHeartbeat } from '../../execution-lifecycle/heartbeat-throttle.helpers';

@Injectable()
export class WorkflowRunHeartbeatService {
  private readonly logger = new Logger(WorkflowRunHeartbeatService.name);
  private readonly lastEmittedAtMs = new Map<string, number>();

  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
  ) {}

  private now(): number {
    return Date.now();
  }

  recordActivity(runId: string): void {
    if (!runId) {
      return;
    }
    const nowMs = this.now();
    if (!shouldEmitHeartbeat(this.lastEmittedAtMs.get(runId), nowMs)) {
      return;
    }
    this.lastEmittedAtMs.set(runId, nowMs);
    void this.runRepo.touch(runId).catch((error: unknown) => {
      this.logger.debug(
        `Run heartbeat touch failed for ${runId}: ${(error as Error).message}`,
      );
    });
  }

  forget(runId: string): void {
    this.lastEmittedAtMs.delete(runId);
  }
}
