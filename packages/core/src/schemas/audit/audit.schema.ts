import { z } from "zod";

export const AuditLogEntrySchema = z.object({
  id: z.uuid(),
  eventType: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  targetUserEmail: z.string().optional(),
  roleName: z.string().optional(),
  inheritedBy: z.array(z.string()).optional(),
  scopeNodeId: z.string().nullable(),
  scopeNodeName: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});

export const AuditLogResponseSchema = z.object({
  entries: z.array(AuditLogEntrySchema),
  total: z.number().int().nonnegative(),
});
