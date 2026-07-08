import { Injectable, Logger } from "@nestjs/common";
import type Redis from "ioredis";
import type { WorkItemRealtimePayload } from "./work-item-realtime.publisher.types";

export type { WorkItemRealtimePayload } from "./work-item-realtime.publisher.types";

@Injectable()
export class WorkItemRealtimePublisher {
  private readonly logger = new Logger(WorkItemRealtimePublisher.name);

  constructor(private readonly redis: Redis) {}

  async publish(
    projectId: string,
    workItem: Record<string, unknown>,
  ): Promise<void> {
    const channel = `wi:${projectId}`;
    const payload: WorkItemRealtimePayload = { projectId, workItem };
    try {
      await this.redis.publish(channel, JSON.stringify(payload));
    } catch (err) {
      this.logger.error(
        `WorkItemRealtimePublisher: failed to publish to ${channel}`,
        err,
      );
    }
  }
}
