import { z } from "zod";
import { McpTransportType } from "../../interfaces/mcp.types";
import { ExecutionContextSchema } from "../execution-context.schema";

export const WorkflowRunMetadataV1Schema = z
  .object({
    correlation_id: z.string().min(1),
    causation_id: z.string().min(1).nullable().optional(),
    idempotency_key: z.string().min(1).nullable().optional(),
    requested_by: z.string().min(1).nullable().optional(),
  })
  .strict();

/**
 * @deprecated Use ExecutionContextSchema instead. This alias will be removed in a future release.
 */
export const WorkflowRunContextV1Schema = ExecutionContextSchema;

export const WorkflowRunExternalMcpMountV1Schema = z
  .object({
    id: z.string().min(1),
    server_id: z.string().min(1).optional(),
    transport_type: z.enum(McpTransportType),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    url: z.url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    include_tools: z.array(z.string()).optional(),
    exclude_tools: z.array(z.string()).optional(),
  })
  .strict();

export const WorkflowRunRequestV1Schema = z
  .object({
    workflow_id: z.string().min(1),
    input: z.record(z.string(), z.unknown()),
    launch_source: z.string().min(1),
    context: ExecutionContextSchema.nullable().optional(),
    metadata: WorkflowRunMetadataV1Schema,
    external_mcp_mounts: z
      .array(WorkflowRunExternalMcpMountV1Schema)
      .optional(),
  })
  .strict();

export const WorkflowRunAcceptedV1Schema = z
  .object({
    run_id: z.string().min(1),
    workflow_id: z.string().min(1),
    status: z.literal("accepted"),
    accepted_at: z.iso.datetime(),
    metadata: WorkflowRunMetadataV1Schema,
  })
  .strict();

export const WORKFLOW_RUN_EXECUTION_STATUS_VALUES = [
  "PENDING",
  "RUNNING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
] as const;

export const WorkflowRunExecutionStatusV1Schema = z.enum(
  WORKFLOW_RUN_EXECUTION_STATUS_VALUES,
);

export const WorkflowRunStatusV1Schema = z
  .object({
    run_id: z.string().min(1),
    workflow_id: z.string().min(1),
    status: WorkflowRunExecutionStatusV1Schema,
    current_step_id: z.string().min(1).nullable().optional(),
    updated_at: z.iso.datetime(),
    metadata: WorkflowRunMetadataV1Schema,
  })
  .strict();

export const WorkflowRunControlActionV1Schema = z.enum([
  "pause",
  "resume",
  "abort",
]);

export const WorkflowRunControlRequestV1Schema = z
  .object({
    run_id: z.string().min(1),
    action: WorkflowRunControlActionV1Schema,
    reason: z.string().min(1).optional(),
    metadata: WorkflowRunMetadataV1Schema,
  })
  .strict();

export const WorkflowRunScopeCancelRequestV1Schema = z
  .object({
    reason: z.string().min(1).optional(),
    metadata: WorkflowRunMetadataV1Schema,
  })
  .strict();

export const WorkflowRunControlResultV1Schema = z
  .object({
    run_id: z.string().min(1),
    action: WorkflowRunControlActionV1Schema,
    accepted: z.boolean(),
    status: WorkflowRunExecutionStatusV1Schema,
    message: z.string().min(1).optional(),
    updated_at: z.iso.datetime(),
    metadata: WorkflowRunMetadataV1Schema,
  })
  .strict();

export const WorkflowRunScopeCancelResultV1Schema = z
  .object({
    scope_id: z.string().min(1),
    requested_runs: z.number().int().min(0),
    cancelled_runs: z.number().int().min(0),
    skipped_runs: z.number().int().min(0),
    cancelled_run_ids: z.array(z.uuid()),
    reason: z.string().min(1).optional(),
    metadata: WorkflowRunMetadataV1Schema,
  })
  .strict();

export * from "./workflow-run-contracts.types";
