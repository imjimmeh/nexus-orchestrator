import { z } from "zod";
import {
  AcpAuthType,
  AcpAwaitPolicy,
  AcpRunMode,
} from "../../interfaces/acp.types";

// ── ACP Server create/update ──────────────────────────────────────────────────

// UUID v4 (and v1-v5 are accepted) pattern — matches PG `uuid` column type.
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SecretIdSchema = z
  .string()
  .regex(UUID_PATTERN, "must be a valid UUID v4 reference to secret_store.id");

export const CreateAcpServerSchema = z.object({
  name: z.string().min(1).max(120),
  enabled: z.boolean().default(true),
  url: z.url(),
  auth_type: z.enum(AcpAuthType),
  auth_token: z.string().min(1).optional(),
  auth_secret_id: SecretIdSchema.optional(),
  headers: z.record(z.string(), z.string()).optional(),
  headers_secret_id: SecretIdSchema.optional(),
  include_agents: z.array(z.string()).optional(),
  exclude_agents: z.array(z.string()).optional(),
  timeout_ms: z.number().int().min(100).max(300000).optional(),
  connect_timeout_ms: z.number().int().min(100).max(120000).optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
  retry_backoff_ms: z.number().int().min(50).max(120000).optional(),
  default_run_mode: z.enum(AcpRunMode).optional(),
  await_policy: z.enum(AcpAwaitPolicy).optional(),
});

export const UpdateAcpServerSchema = CreateAcpServerSchema.partial();

// ── ACP Agent invocation ──────────────────────────────────────────────────────

export const InvokeAcpAgentSchema = z.object({
  params: z.record(z.string(), z.unknown()).optional(),
  session_id: z.string().min(1).optional(),
  run_mode: z.enum(AcpRunMode).optional(),
});

export type {
  CreateAcpServerRequest,
  UpdateAcpServerRequest,
  InvokeAcpAgentRequest,
} from "./acp-server.types";
