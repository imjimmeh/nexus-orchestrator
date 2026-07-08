import { Injectable, NotFoundException } from "@nestjs/common";
import type { KanbanExternalConnectionEntity } from "../../database/entities/kanban-external-connection.entity.js";
import { KanbanExternalConnectionRepository } from "../../database/repositories/kanban-external-connection.repository.js";
import { KanbanSyncOperationLogRepository } from "../../database/repositories/kanban-sync-operation-log.repository.js";
import type {
  InboundTicketSyncResult,
  SyncRunResult,
} from "../external-sync.types.js";
import { ProviderRegistryService } from "../providers/provider-registry.service.js";
import { InboundSyncService } from "./inbound-sync.service.js";

type RunOperation = "import" | "sync";

@Injectable()
export class SyncCoordinatorService {
  constructor(
    private readonly connections: KanbanExternalConnectionRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly inboundSync: InboundSyncService,
    private readonly operationLogs: KanbanSyncOperationLogRepository,
  ) {}

  importTickets(
    projectId: string,
    connectionId: string,
  ): Promise<SyncRunResult> {
    return this.runInbound(projectId, connectionId, "import");
  }

  sync(projectId: string, connectionId: string): Promise<SyncRunResult> {
    return this.runInbound(projectId, connectionId, "sync");
  }

  // Note: Deleted external ticket events are not surfaced through fetchTickets().
  // Deletion handling is driven by webhook events via InboundSyncService.processDeletedEvent().
  private async runInbound(
    projectId: string,
    connectionId: string,
    operation: RunOperation,
  ): Promise<SyncRunResult> {
    const connection = await this.requireConnection(projectId, connectionId);
    const provider = this.providerRegistry.resolve(connection.provider_type);
    const counts: SyncRunResult = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    let cursor: string | undefined;
    try {
      do {
        const page = await provider.fetchTickets(
          cursor === undefined ? undefined : { cursor },
        );
        for (const ticket of page.items) {
          const result = await this.inboundSync.processTicket(
            connection,
            ticket,
            operation,
          );
          this.applyResult(counts, result);
        }
        cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
      } while (cursor !== undefined);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Provider fetch failed";
      await this.logProviderFailure(connection, operation, message);
      await this.connections.markSyncFailure(connection.id, message);
      throw error;
    }

    await this.connections.markSyncSuccess(connection.id, new Date());
    return counts;
  }

  private async requireConnection(
    projectId: string,
    connectionId: string,
  ): Promise<KanbanExternalConnectionEntity> {
    const connection = await this.connections.findByProjectAndId(
      projectId,
      connectionId,
    );
    if (!connection) {
      throw new NotFoundException(
        `External connection ${connectionId} not found in project ${projectId}`,
      );
    }
    return connection;
  }

  private applyResult(
    counts: SyncRunResult,
    result: InboundTicketSyncResult,
  ): void {
    counts.processed += 1;
    if (result.action === "created") counts.created += 1;
    if (result.action === "updated") counts.updated += 1;
    if (result.status === "skipped" || result.status === "noop")
      counts.skipped += 1;
    if (result.status === "failed") counts.failed += 1;
  }

  private async logProviderFailure(
    connection: KanbanExternalConnectionEntity,
    operation: RunOperation,
    message: string,
  ): Promise<void> {
    const log = await this.operationLogs.createOperation({
      connection_id: connection.id,
      project_id: connection.project_id,
      direction: "inbound",
      operation,
      status: "pending",
    });
    await this.operationLogs.completeOperation(log.id, "failed", message, {
      action: "fetchTickets",
    });
  }
}
