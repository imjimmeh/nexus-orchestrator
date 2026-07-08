import { z } from "zod";
import { McpTransportType } from "../../interfaces/mcp.types";

// ── MCP Server create/update ──────────────────────────────────────────────────

// UUID v4 (and v1-v5 are accepted) pattern — matches PG `uuid` column type.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SecretIdSchema = z
  .string()
  .regex(UUID_PATTERN, "must be a valid UUID v4 reference to secret_store.id");

export const CreateMcpServerSchema = z
  .object({
    name: z.string().min(1).max(120),
    enabled: z.boolean().default(true),
    transport_type: z.enum(McpTransportType),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    url: z.url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    headers_secret_id: SecretIdSchema.optional(),
    env: z.record(z.string(), z.string()).optional(),
    env_secret_id: SecretIdSchema.optional(),
    include_tools: z.array(z.string()).optional(),
    exclude_tools: z.array(z.string()).optional(),
    timeout_ms: z.number().int().min(100).max(300000).optional(),
    connect_timeout_ms: z.number().int().min(100).max(120000).optional(),
    max_retries: z.number().int().min(0).max(10).optional(),
    retry_backoff_ms: z.number().int().min(50).max(120000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.transport_type === McpTransportType.STDIO && !data.command) {
      ctx.addIssue({
        code: "custom",
        message: "command is required for stdio transport",
        path: ["command"],
      });
    }
    if (data.transport_type === McpTransportType.HTTP && !data.url) {
      ctx.addIssue({
        code: "custom",
        message: "url is required for http transport",
        path: ["url"],
      });
    }
    if (
      data.env_secret_id !== undefined &&
      data.transport_type !== McpTransportType.STDIO
    ) {
      ctx.addIssue({
        code: "custom",
        message: "env_secret_id is only valid for stdio transport",
        path: ["env_secret_id"],
      });
    }
  });

export const UpdateMcpServerSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    transport_type: z.enum(McpTransportType).optional(),
    command: z.string().min(1).optional(),
    args: z.array(z.string()).optional(),
    url: z.url().optional(),
    headers: z.record(z.string(), z.string()).optional(),
    headers_secret_id: SecretIdSchema.optional(),
    env: z.record(z.string(), z.string()).optional(),
    env_secret_id: SecretIdSchema.optional(),
    include_tools: z.array(z.string()).optional(),
    exclude_tools: z.array(z.string()).optional(),
    timeout_ms: z.number().int().min(100).max(300000).optional(),
    connect_timeout_ms: z.number().int().min(100).max(120000).optional(),
    max_retries: z.number().int().min(0).max(10).optional(),
    retry_backoff_ms: z.number().int().min(50).max(120000).optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.env_secret_id !== undefined &&
      data.transport_type !== undefined &&
      data.transport_type !== McpTransportType.STDIO
    ) {
      ctx.addIssue({
        code: "custom",
        message: "env_secret_id is only valid for stdio transport",
        path: ["env_secret_id"],
      });
    }
  });

// ── MCP Tool invocation ───────────────────────────────────────────────────────

export const InvokeMcpToolSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
});

export type {
  CreateMcpServerRequest,
  UpdateMcpServerRequest,
  InvokeMcpToolRequest,
} from "./mcp-server.types";
