import { Injectable } from "@nestjs/common";
import { isSupportedWorkItemStatus } from "../../work-item/work-item.service.helpers.js";
import type { ExternalConnectionRecord } from "../external-sync.types.js";
import type { ExternalTicket } from "../providers/external-ticket-provider.types.js";

const FALLBACK_STATUS = "todo";

type MapperConnection = Pick<
  ExternalConnectionRecord,
  "id" | "provider_type" | "field_mapping"
>;

interface WorkItemSyncInput {
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  metadata: Record<string, unknown>;
}

@Injectable()
export class FieldMapperService {
  mapExternalTicketToWorkItemInput(
    connection: MapperConnection,
    ticket: ExternalTicket,
  ): WorkItemSyncInput {
    const fieldMapping = isRecord(connection.field_mapping)
      ? connection.field_mapping
      : {};

    const title = this.resolveField(
      ticket,
      fieldMapping,
      "title",
      ticket.title,
    );
    const description = this.resolveField(
      ticket,
      fieldMapping,
      "description",
      ticket.description ?? null,
    );
    const rawStatus = this.resolveField(
      ticket,
      fieldMapping,
      "status",
      ticket.status ?? null,
    );
    const priority = this.resolveField(
      ticket,
      fieldMapping,
      "priority",
      ticket.priority ?? null,
    );

    const status = this.validateStatus(rawStatus);

    const metadata: Record<string, unknown> = {};
    metadata.external_sync = {
      connection_id: connection.id,
      external_id: ticket.id,
      provider_type: connection.provider_type,
      url: ticket.url ?? null,
      sourceCreatedAt: ticket.createdAt ?? null,
      sourceUpdatedAt: ticket.updatedAt ?? null,
      synced_at: new Date().toISOString(),
    };

    return {
      title: title ?? "",
      description: description !== null ? description : null,
      status,
      priority: priority !== null ? priority : null,
      metadata,
    };
  }

  mapWorkItemToExternalTicket(
    workItem: {
      title: string;
      description?: string;
      status?: string;
      priority?: string;
    },
    fieldMapping?: Record<string, unknown>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    const mapField = (internalKey: string, value: string | undefined): void => {
      if (value === undefined || value === "") return;
      const mappedValue = fieldMapping?.[internalKey];
      const externalKey =
        typeof mappedValue === "string" ? mappedValue : internalKey;
      result[externalKey] = value;
    };

    mapField("title", workItem.title);
    mapField("description", workItem.description);
    mapField("status", workItem.status);
    mapField("priority", workItem.priority);

    return result;
  }

  private resolveField(
    ticket: ExternalTicket,
    fieldMapping: Record<string, unknown>,
    fieldKey: string,
    defaultValue: string | null,
  ): string | null {
    const mappedKey = fieldMapping[fieldKey];
    if (typeof mappedKey !== "string") {
      return defaultValue;
    }

    const resolved =
      this.getValueByPath(ticket, mappedKey) ??
      this.getValueByPath(ticket.rawMetadata, mappedKey);

    if (resolved !== undefined) {
      if (typeof resolved === "string") return resolved;
      if (typeof resolved === "number" || typeof resolved === "boolean")
        return String(resolved);
    }

    return defaultValue;
  }

  private getValueByPath(obj: unknown, path: string): unknown {
    const parts = path.split(".");
    let current: unknown = obj;

    for (const part of parts) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== "object"
      ) {
        return undefined;
      }
      if (!Object.prototype.hasOwnProperty.call(current, part)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  private validateStatus(raw: string | null | undefined): string {
    if (raw === null || raw === undefined) {
      return FALLBACK_STATUS;
    }
    const trimmed = raw.trim();
    if (trimmed === "") {
      return FALLBACK_STATUS;
    }
    if (isSupportedWorkItemStatus(trimmed)) {
      return trimmed;
    }
    return FALLBACK_STATUS;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
