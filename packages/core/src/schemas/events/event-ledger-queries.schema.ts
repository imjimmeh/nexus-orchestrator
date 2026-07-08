import { z } from "zod";

const uuidContextField = z.uuid();

function toBoundedInt(
  value: unknown,
  options: { defaultValue: number; min: number; max: number },
): number {
  const parsed = toInteger(value);
  if (parsed === null) {
    return options.defaultValue;
  }

  return Math.min(Math.max(parsed, options.min), options.max);
}

function toInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }

    const parsed = Number(normalized);
    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return null;
}

export const emitInternalEventLedgerSchema = z.object({
  domain: z.string().min(1),
  eventName: z.string().min(1),
  outcome: z.enum(["success", "failure", "denied", "in_progress"]),
  severity: z.enum(["info", "warn", "error", "critical"]).optional(),
  source: z.string().optional(),
  actorType: z.enum(["user", "agent", "system"]).optional(),
  actorId: z.string().optional(),
  context: z
    .object({
      scopeId: uuidContextField.nullable().optional(),
      contextId: uuidContextField.nullable().optional(),
      contextType: z.string().nullable().optional(),
    })
    .optional(),
  workflowId: uuidContextField.optional(),
  workflowRunId: uuidContextField.optional(),
  jobId: z.string().optional(),
  stepId: z.string().optional(),
  toolId: z.string().optional(),
  toolName: z.string().optional(),
  subagentExecutionId: z.string().optional(),
  sessionTreeId: z.string().optional(),
  requestId: z.string().optional(),
  correlationId: z.string().optional(),
  parentEventId: uuidContextField.optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

export const EVENT_SORT_COLUMNS = [
  "occurred_at",
  "domain",
  "severity",
  "outcome",
] as const;

export const queryEventLedgerSchema = z.object({
  domain: z.string().optional(),
  eventName: z.string().optional(),
  outcome: z.enum(["success", "failure", "denied", "in_progress"]).optional(),
  severity: z.enum(["info", "warn", "error", "critical"]).optional(),
  source: z.string().optional(),
  actorType: z.enum(["user", "agent", "system"]).optional(),
  actorId: z.string().optional(),
  context: z
    .object({
      scopeId: z.uuid().nullable().optional(),
      contextId: z.uuid().nullable().optional(),
      contextType: z.string().nullable().optional(),
    })
    .optional(),
  workflowId: z.uuid().optional(),
  workflowRunId: z.uuid().optional(),
  jobId: z.string().optional(),
  stepId: z.string().optional(),
  toolName: z.string().optional(),
  requestId: z.string().optional(),
  correlationId: z.string().optional(),
  occurredAfter: z.iso.datetime().optional(),
  occurredBefore: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  offset: z.coerce.number().int().min(0).optional().default(0),
  search: z.string().min(1).max(200).optional(),
  sortBy: z
    .string()
    .optional()
    .refine(
      (v) => !v || (EVENT_SORT_COLUMNS as readonly string[]).includes(v),
      {
        message: `sortBy must be one of: ${EVENT_SORT_COLUMNS.join(", ")}`,
      },
    ),
  sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
});

export const correlationTimelineQuerySchema = z.object({
  limit: z
    .preprocess(
      (value) => toBoundedInt(value, { defaultValue: 100, min: 1, max: 1000 }),
      z.number().int().min(1).max(1000),
    )
    .optional()
    .default(100),
  offset: z
    .preprocess(
      (value) =>
        toBoundedInt(value, {
          defaultValue: 0,
          min: 0,
          max: Number.MAX_SAFE_INTEGER,
        }),
      z.number().int().min(0),
    )
    .optional()
    .default(0),
});

export type EmitInternalEventLedgerRequest = z.infer<
  typeof emitInternalEventLedgerSchema
>;

export type QueryEventLedgerRequest = z.infer<typeof queryEventLedgerSchema>;

export type CorrelationTimelineQueryRequest = z.infer<
  typeof correlationTimelineQuerySchema
>;
