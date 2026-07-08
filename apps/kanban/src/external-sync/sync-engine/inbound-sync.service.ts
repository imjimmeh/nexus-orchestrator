import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { KanbanExternalConnectionEntity } from "../../database/entities/kanban-external-connection.entity.js";
import type { KanbanWorkItemEntity } from "../../database/entities/kanban-work-item.entity.js";
import { KanbanSyncOperationLogRepository } from "../../database/repositories/kanban-sync-operation-log.repository.js";
import { KanbanWorkItemRepository } from "../../database/repositories/kanban-work-item.repository.js";
import type { InboundTicketSyncResult } from "../external-sync.types.js";
import type {
  ExternalTicket,
  ExternalTicketChangeEvent,
} from "../providers/external-ticket-provider.types.js";
import { ConflictResolverService } from "./conflict-resolver.service.js";
import { FieldMapperService } from "./field-mapper.service.js";

type SyncOperation = "import" | "sync";

@Injectable()
export class InboundSyncService {
  constructor(
    private readonly workItems: KanbanWorkItemRepository,
    private readonly operationLogs: KanbanSyncOperationLogRepository,
    private readonly fieldMapper: FieldMapperService,
    private readonly conflictResolver: ConflictResolverService,
  ) {}

  async processTicket(
    connection: KanbanExternalConnectionEntity,
    ticket: ExternalTicket,
    operation: SyncOperation,
  ): Promise<InboundTicketSyncResult> {
    const log = await this.operationLogs.createOperation({
      connection_id: connection.id,
      project_id: connection.project_id,
      external_id: ticket.id,
      direction: "inbound",
      operation,
      status: "pending",
    });

    const mapped = this.fieldMapper.mapExternalTicketToWorkItemInput(
      connection,
      ticket,
    );
    const existing = await this.workItems.findByExternalSyncRef(
      connection.project_id,
      connection.id,
      ticket.id,
    );

    if (!existing) {
      const created = await this.workItems.save({
        id: randomUUID(),
        project_id: connection.project_id,
        title: mapped.title,
        description: mapped.description,
        status: mapped.status,
        priority: mapped.priority ?? "p2",
        type: "story",
        assigned_agent_id: null,
        token_spend: 0,
        current_execution_id: null,
        waiting_for_input: false,
        execution_config: null,
        metadata: mapped.metadata,
        linked_run_id: null,
      });
      await this.operationLogs.completeOperation(
        log.id,
        "success",
        `Created work item ${created.id} from external ticket ${ticket.id}`,
        { action: "created", workItemId: created.id },
      );
      return { action: "created", status: "success" };
    }

    const resolution = this.conflictResolver.resolveExternalUpdate({
      externalUpdatedAt: ticket.updatedAt ?? null,
      workItemUpdatedAt: existing.updated_at.toISOString(),
      externalId: ticket.id,
      workItemId: existing.id,
    });

    if (
      resolution.decision === "skip_external" ||
      resolution.decision === "noop"
    ) {
      const status = resolution.decision === "noop" ? "noop" : "skipped";
      const action = resolution.decision === "noop" ? "noop" : "skipped";
      await this.operationLogs.completeOperation(
        log.id,
        status,
        `${action === "noop" ? "Noop" : "Skipped"} external ticket ${ticket.id}: ${resolution.reason}`,
        { action, conflict: resolution.details },
      );
      return { action, status };
    }

    await this.workItems.save(
      this.toSavePayload(existing, {
        title: mapped.title,
        description: mapped.description,
        status: mapped.status,
        priority: mapped.priority ?? existing.priority,
        metadata: mapped.metadata,
      }),
    );
    await this.operationLogs.completeOperation(
      log.id,
      "success",
      `Updated work item ${existing.id} from external ticket ${ticket.id}`,
      {
        action: "updated",
        workItemId: existing.id,
        conflict: resolution.details,
      },
    );
    return { action: "updated", status: "success" };
  }

  /**
   * Handles webhook-driven deleted external ticket events.
   * Marks the linked work item with metadata.external_sync.deletion_seen = true
   * rather than physically deleting the work item.
   */
  async processDeletedEvent(
    connection: KanbanExternalConnectionEntity,
    event: ExternalTicketChangeEvent,
    operation: SyncOperation,
  ): Promise<InboundTicketSyncResult> {
    const log = await this.operationLogs.createOperation({
      connection_id: connection.id,
      project_id: connection.project_id,
      external_id: event.externalId,
      direction: "inbound",
      operation,
      status: "pending",
    });
    const existing = await this.workItems.findByExternalSyncRef(
      connection.project_id,
      connection.id,
      event.externalId,
    );

    if (!existing) {
      await this.operationLogs.completeOperation(
        log.id,
        "skipped",
        `Skipped deleted external ticket ${event.externalId}: no linked work item`,
        { action: "skipped" },
      );
      return { action: "skipped", status: "skipped" };
    }

    await this.workItems.save(
      this.toSavePayload(existing, {
        metadata: this.withDeletionMarker(existing, event.timestamp),
      }),
    );
    await this.operationLogs.completeOperation(
      log.id,
      "success",
      `Marked work item ${existing.id} for deleted external ticket ${event.externalId}`,
      { action: "deleted", workItemId: existing.id },
    );
    return { action: "deleted", status: "success" };
  }

  private withDeletionMarker(
    workItem: KanbanWorkItemEntity,
    deletedAt: string,
  ): Record<string, unknown> {
    const metadata = workItem.metadata ?? {};
    const existingSync = this.getExternalSyncMetadata(metadata);
    return {
      ...metadata,
      external_sync: {
        ...existingSync,
        deleted_at: deletedAt,
        deletion_seen: true,
      },
    };
  }

  private getExternalSyncMetadata(
    metadata: Record<string, unknown>,
  ): Record<string, unknown> {
    const value = metadata.external_sync;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private toSavePayload(
    workItem: KanbanWorkItemEntity,
    patch: Partial<KanbanWorkItemEntity>,
  ): Partial<KanbanWorkItemEntity> {
    return {
      id: workItem.id,
      project_id: workItem.project_id,
      title: patch.title ?? workItem.title,
      description:
        "description" in patch
          ? (patch.description ?? null)
          : workItem.description,
      status: patch.status ?? workItem.status,
      priority: patch.priority ?? workItem.priority,
      type: workItem.type,
      assigned_agent_id: workItem.assigned_agent_id,
      token_spend: workItem.token_spend,
      current_execution_id: workItem.current_execution_id,
      waiting_for_input: workItem.waiting_for_input,
      execution_config: workItem.execution_config,
      metadata:
        "metadata" in patch ? (patch.metadata ?? null) : workItem.metadata,
      linked_run_id: workItem.linked_run_id,
      created_at: workItem.created_at,
      updated_at: workItem.updated_at,
    };
  }
}
