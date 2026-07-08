import { z } from "zod";
import type {
  AuditLogEntrySchema,
  AuditLogResponseSchema,
} from "./audit.schema";

export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;
