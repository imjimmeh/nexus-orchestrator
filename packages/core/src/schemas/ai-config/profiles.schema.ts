import { z } from "zod";
import { providerOwnerTypeSchema } from "./providers.schema";
import { HarnessContributionsInputSchema } from "./harness-contributions.schema";
import { RunnerThinkingLevelSchema } from "./thinking-level.schema";

const FallbackChainEntrySchema = z.object({
  provider_name: z.string().min(1),
  model_name: z.string().min(1),
});

const uniqueStringArray = () =>
  z.array(z.string()).refine((arr) => new Set(arr).size === arr.length, {
    message: "Array must contain unique values",
  });

export const AgentProfileToolPolicySchema = z.object({
  default: z.enum(["allow", "deny", "require_approval", "guardrail_deny"]),
  rules: z.array(
    z.union([
      z.string(),
      z.object({
        id: z.string().optional(),
        effect: z.enum(["allow", "deny", "require_approval", "guardrail_deny"]),
        tool: z.string(),
        arguments: z.record(z.string(), z.any()).optional(),
        reason: z.string().optional(),
      }),
    ]),
  ),
});

export const CreateAgentProfileSchema = z.object({
  name: z.string().min(1),
  system_prompt: z.string().optional(),
  model_name: z.string().optional(),
  provider_name: z.string().optional(),
  provider_id: z.uuid().optional(),
  provider_source: providerOwnerTypeSchema.optional(),
  tier_preference: z.string().optional(),
  allowed_mount_aliases: uniqueStringArray().optional(),
  denied_mount_aliases: uniqueStringArray().optional(),
  allow_rw_mount_aliases: uniqueStringArray().optional(),
  is_active: z.boolean().optional(),
  tool_policy: AgentProfileToolPolicySchema.optional().nullable(),
  harness_contributions: HarnessContributionsInputSchema.optional().nullable(),
  thinking_level: RunnerThinkingLevelSchema.nullable().optional(),
  fallback_chain: z.array(FallbackChainEntrySchema).optional().nullable(),
});

export const UpdateAgentProfileSchema = CreateAgentProfileSchema.partial();

export const AssignProfileSkillsSchema = z.object({
  skill_ids: z
    .array(
      z
        .string()
        .max(64)
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
          message:
            "skill_ids entries must be lowercase names with letters, numbers, and hyphens",
        }),
    )
    .refine((arr) => new Set(arr).size === arr.length, {
      message: "skill_ids must be unique",
    }),
});

export * from "./profiles.types";
