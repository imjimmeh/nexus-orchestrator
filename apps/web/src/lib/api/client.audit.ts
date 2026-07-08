import { AuditLogResponseSchema } from "@nexus/core";
import type { ApiClient } from "./client";
import type {
  ApiClientAuditMethods,
  AuditLogFilters,
  AuditLogResponse,
} from "./client.audit.types";

export type { ApiClientAuditMethods };

export const auditApiMethods: ApiClientAuditMethods = {
  async getAuditLog(
    this: ApiClient,
    filters: AuditLogFilters = {},
  ): Promise<AuditLogResponse> {
    const params = new URLSearchParams();
    if (filters.scopeNodeId) params.set("scopeNodeId", filters.scopeNodeId);
    if (filters.eventType) params.set("eventType", filters.eventType);
    if (filters.userId) params.set("userId", filters.userId);
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    if (filters.limit !== null && filters.limit !== undefined)
      params.set("limit", String(filters.limit));
    if (filters.offset !== null && filters.offset !== undefined)
      params.set("offset", String(filters.offset));
    const query = params.toString();
    const raw = await this.get<unknown>(`/audit${query ? `?${query}` : ""}`);
    return AuditLogResponseSchema.parse(raw);
  },
};
