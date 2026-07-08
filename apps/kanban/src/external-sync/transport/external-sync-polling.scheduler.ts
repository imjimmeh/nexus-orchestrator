import { InjectQueue } from "@nestjs/bullmq";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import type { Queue } from "bullmq";
import { KanbanExternalConnectionRepository } from "../../database/repositories/kanban-external-connection.repository.js";
import { EXTERNAL_SYNC_POLLING_QUEUE } from "./external-sync-polling.queue.js";

const DEFAULT_POLL_INTERVAL_MS = 300000;

@Injectable()
export class ExternalSyncPollingScheduler
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ExternalSyncPollingScheduler.name);
  private registeredConnections: Array<{
    connectionId: string;
    intervalMs: number;
  }> = [];

  constructor(
    @InjectQueue(EXTERNAL_SYNC_POLLING_QUEUE)
    private readonly queue: Queue,
    private readonly connections: KanbanExternalConnectionRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const connections = await this.connections.listActivePollingConnections();

    for (const connection of connections) {
      if (connection.status !== "active") continue;
      if (connection.sync_mode === "outbound") continue;

      const intervalMs = connection.poll_interval_seconds
        ? connection.poll_interval_seconds * 1000
        : DEFAULT_POLL_INTERVAL_MS;

      await this.queue.add(
        connection.id,
        {
          connectionId: connection.id,
          projectId: connection.project_id,
        },
        {
          jobId: connection.id,
          repeat: { every: intervalMs },
        },
      );

      this.registeredConnections.push({
        connectionId: connection.id,
        intervalMs,
      });
      this.logger.log(
        `Registered polling job for connection ${connection.id} (${connection.name})`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const reg of this.registeredConnections) {
      await this.queue.removeJobScheduler(reg.connectionId);
    }
    this.registeredConnections = [];
  }
}
