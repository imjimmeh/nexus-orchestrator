import { z } from "zod";

/**
 * Accepts either a JSON-stringified array or a native string array.
 * Preserves the union in JSON schema so validators (and models) allow
 * both shapes.  Consumers (e.g. pi-runner) must normalise strings to
 * arrays *before* calling `schema.parse()`.
 */
const StringArrayInputSchema = z.union([
  z.string(),
  z.array(z.string().trim().min(1)),
]);

const PositiveIntegerInputSchema = z.union([
  z.string(),
  z.number().int().positive(),
]);

const HostMountRequestSchema = z
  .object({
    alias: z.string().trim().min(1),
    subpath: z.string().trim().min(1).optional(),
    mode: z.enum(["ro", "rw"]).optional(),
  })
  .strict();

export const SpawnSubagentAsyncSchema = z
  .object({
    action: z.literal("spawn_subagent_async"),
    agent_profile: z.string().trim().min(1),
    task_prompt: z.string().trim().min(1),
    tools: StringArrayInputSchema,
    assigned_files: StringArrayInputSchema.optional(),
    host_mounts: z.array(HostMountRequestSchema).optional(),
    inherit_host_mounts: z.boolean().optional(),
  })
  .strict();

export const WaitForSubagentsSchema = z
  .object({
    action: z.literal("wait_for_subagents"),
    execution_ids: StringArrayInputSchema.optional(),
    timeout_seconds: PositiveIntegerInputSchema.optional(),
  })
  .strict();

export const CheckSubagentStatusSchema = z
  .object({
    action: z.literal("check_subagent_status"),
    execution_id: z.string().trim().min(1),
  })
  .strict();

export * from "./subagents.types";
