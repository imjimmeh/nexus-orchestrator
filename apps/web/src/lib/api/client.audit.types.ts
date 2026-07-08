import type { AuditLogEntry, AuditLogResponse } from "@nexus/core";

export type { AuditLogEntry, AuditLogResponse };

export interface AuditLogFilters {
  scopeNodeId?: string;
  eventType?: string;
  userId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface ApiClientAuditMethods {
  getAuditLog(
    this: import("./client").ApiClient,
    filters?: AuditLogFilters,
  ): Promise<AuditLogResponse>;
}
