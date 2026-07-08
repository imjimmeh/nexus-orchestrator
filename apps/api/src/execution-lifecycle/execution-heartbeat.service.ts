import { Injectable, Logger } from '@nestjs/common';
import { ExecutionEventPublisher } from './execution-event.publisher';
import { shouldEmitHeartbeat } from './heartbeat-throttle.helpers';

@Injectable()
export class ExecutionHeartbeatService {
  private readonly logger = new Logger(ExecutionHeartbeatService.name);
  private readonly lastEmittedAtMs = new Map<string, number>();

  constructor(private readonly publisher: ExecutionEventPublisher) {}

  recordActivity(executionId: string, source: string): void {
    if (!executionId) return;
    const now = Date.now();
    if (!shouldEmitHeartbeat(this.lastEmittedAtMs.get(executionId), now)) {
      return;
    }
    this.lastEmittedAtMs.set(executionId, now);
    void this.publisher
      .heartbeat(executionId, { source })
      .catch((error: unknown) => {
        this.logger.debug(
          `Heartbeat emit failed for ${executionId}: ${(error as Error).message}`,
        );
      });
  }

  forget(executionId: string): void {
    this.lastEmittedAtMs.delete(executionId);
  }
}
