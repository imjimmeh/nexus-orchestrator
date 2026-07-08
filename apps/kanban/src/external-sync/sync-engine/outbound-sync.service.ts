import { Injectable, Logger } from "@nestjs/common";
import type { SyncRunResult } from "../external-sync.types.js";
import { KanbanExternalConnectionRepository } from "../../database/repositories/kanban-external-connection.repository.js";
import { KanbanSyncOperationLogRepository } from "../../database/repositories/kanban-sync-operation-log.repository.js";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository.js";
import { FieldMapperService } from "./field-mapper.service.js";
import { ProviderRegistryService } from "../providers/provider-registry.service.js";
import type { IOutboundSyncService } from "../outbound-sync.types.js";

const OUTBOUND_MODES = new Set(["outbound", "bidirectional"]);

function getExternalSyncMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (metadata === null || metadata === undefined) return null;
  const value = metadata.external_sync;
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

@Injectable()
export class OutboundSyncService implements IOutboundSyncService {
  private readonly logger = new Logger(OutboundSyncService.name);

  constructor(
    private readonly workItems: KanbanWorkItemRepository,
    private readonly connections: KanbanExternalConnectionRepository,
    private readonly operationLogs: KanbanSyncOperationLogRepository,
    private readonly providerRegistry: ProviderRegistryService,
    private readonly fieldMapper: FieldMapperService,
  ) {}

  async pushStatusChange(params: {
    projectId: string;
    workItemId: string;
    status: string;
    previousStatus: string | null;
  }): Promise<void> {
    try {
      const workItem = await this.workItems.findByProjectAndId(
        params.projectId,
        params.workItemId,
      );
      if (!workItem) {
        this.logger.warn(
          `Outbound sync skipped: work item ${params.workItemId} not found in project ${params.projectId}`,
        );
        return;
      }

      const externalSync = getExternalSyncMetadata(workItem.metadata);
      if (!externalSync) return;

      const connectionId = externalSync.connection_id;
      if (typeof connectionId !== "string") return;

      const externalId = externalSync.external_id;
      if (typeof externalId !== "string") return;

      const connection = await this.connections.findByProjectAndId(
        params.projectId,
        connectionId,
      );
      if (!connection) {
        this.logger.warn(
          `Outbound sync skipped: connection ${connectionId} not found for project ${params.projectId}`,
        );
        return;
      }

      if (connection.status !== "active") return;
      if (!OUTBOUND_MODES.has(connection.sync_mode)) return;

      const provider = this.providerRegistry.resolve(connection.provider_type);
      if (!provider.capabilities.supportsUpdate) return;

      const mappedFields = this.fieldMapper.mapWorkItemToExternalTicket(
        {
          title: workItem.title,
          description: workItem.description ?? undefined,
          status: workItem.status,
          priority: workItem.priority,
        },
        connection.field_mapping,
      );

      const log = await this.operationLogs.createOperation({
        connection_id: connection.id,
        project_id: params.projectId,
        work_item_id: params.workItemId,
        external_id: externalId,
        direction: "outbound",
        operation: "status_change",
        status: "pending",
      });

      try {
        await provider.updateTicket(externalId, mappedFields);
        await this.operationLogs.completeOperation(
          log.id,
          "success",
          `Completed outbound sync for ticket ${externalId}: status ${params.status}`,
          {
            action: "status_change",
            externalId,
            status: params.status,
            previousStatus: params.previousStatus,
          },
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Outbound sync failed for work item ${params.workItemId} ticket ${externalId}: ${message}`,
        );
        await this.operationLogs.completeOperation(
          log.id,
          "failed",
          `Outbound sync failed: ${message}`,
          {
            action: "status_change",
            externalId,
            status: params.status,
            error: message,
          },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Outbound sync pushStatusChange unexpected error: ${message}`,
      );
    }
  }

  async exportWorkItems(
    projectId: string,
    connectionId: string,
  ): Promise<SyncRunResult> {
    const result: SyncRunResult = {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
    };

    const allWorkItems = await this.workItems.findByproject_id(projectId);
    const eligible = allWorkItems.filter((wi) => {
      const externalSync = getExternalSyncMetadata(wi.metadata);
      if (!externalSync) return false;
      return externalSync.connection_id === connectionId;
    });

    if (eligible.length === 0) return result;

    const connection = await this.connections.findByProjectAndId(
      projectId,
      connectionId,
    );
    if (!connection) {
      this.logger.warn(
        `Export skipped: connection ${connectionId} not found in project ${projectId}`,
      );
      return result;
    }

    const provider = this.providerRegistry.resolve(connection.provider_type);

    for (const workItem of eligible) {
      result.processed++;
      const externalSync = getExternalSyncMetadata(workItem.metadata);
      if (!externalSync) {
        result.skipped++;
        continue;
      }

      const externalId =
        typeof externalSync.external_id === "string"
          ? externalSync.external_id
          : undefined;

      const mappedFields = this.fieldMapper.mapWorkItemToExternalTicket(
        {
          title: workItem.title,
          description: workItem.description ?? undefined,
          status: workItem.status,
          priority: workItem.priority,
        },
        connection.field_mapping,
      );

      const log = await this.operationLogs.createOperation({
        connection_id: connection.id,
        project_id: projectId,
        work_item_id: workItem.id,
        external_id: externalId ?? null,
        direction: "outbound",
        operation: "export",
        status: "pending",
      });

      try {
        if (externalId && provider.capabilities.supportsUpdate) {
          await provider.updateTicket(externalId, mappedFields);
          result.updated++;
          await this.operationLogs.completeOperation(
            log.id,
            "success",
            `Exported updated ticket ${externalId}`,
            { action: "export", externalId, type: "update" },
          );
        } else if (provider.capabilities.supportsCreate) {
          const created = await provider.createTicket(mappedFields);
          result.created++;
          await this.operationLogs.completeOperation(
            log.id,
            "success",
            `Exported new ticket ${created.id}`,
            { action: "export", externalId: created.id, type: "create" },
          );
        } else {
          result.skipped++;
          await this.operationLogs.completeOperation(
            log.id,
            "skipped",
            "Provider does not support create or update",
            { action: "export", type: "skipped" },
          );
        }
      } catch (error) {
        result.failed++;
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Export failed for work item ${workItem.id}: ${message}`,
        );
        await this.operationLogs.completeOperation(
          log.id,
          "failed",
          `Export failed: ${message}`,
          { action: "export", error: message },
        );
      }
    }

    return result;
  }
}
