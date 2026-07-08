import { z } from "zod";

export const ExecutionContextSchema = z
  .object({
    scopeId: z.string().nullable(),
    contextId: z.string().nullable(),
    contextType: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    scopeNodeId: z.string().nullable().default(null),
    scopePath: z.array(z.string()).nullable().default(null),
  })
  .strict();
