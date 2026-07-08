import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import type { Queue } from "bullmq";
import { CHARTER_REGEN_QUEUE } from "./charter-regen.queue";

const DEBOUNCE_MS = 2000;

@Injectable()
export class CharterRegenEnqueuer {
  private readonly logger = new Logger(CharterRegenEnqueuer.name);
  constructor(
    @InjectQueue(CHARTER_REGEN_QUEUE) private readonly queue: Queue,
  ) {}

  async enqueue(projectId: string): Promise<void> {
    try {
      await this.queue.add(
        "regen",
        { projectId },
        {
          jobId: `charter-regen:${projectId}`,
          delay: DEBOUNCE_MS,
          attempts: 3,
          backoff: { type: "exponential", delay: 1000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    } catch (error) {
      this.logger.warn(
        `Failed to enqueue charter regen for ${projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
