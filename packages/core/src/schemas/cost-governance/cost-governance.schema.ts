import { z } from "zod";

export const BudgetContextTypeSchema = z.enum(["workflow_run", "chat_session"]);

export const BudgetActorTypeSchema = z.enum([
  "user",
  "agent",
  "workflow",
  "subagent",
  "system",
]);

export const BudgetActionTypeSchema = z.enum([
  "chat_turn",
  "workflow_launch",
  "step_execution",
  "agent_dispatch",
  "subagent_spawn",
  "tool_call",
]);

export const BudgetPolicyScopeTypeSchema = z.enum([
  "global",
  "scope",
  "context",
  "workflow_definition",
  "agent_profile",
  "provider",
  "model",
]);

export const BudgetPolicyWindowSchema = z.enum([
  "per_run",
  "daily",
  "weekly",
  "monthly",
  "rolling",
]);

export const BudgetSummaryWindowSchema = z.enum(["daily", "weekly", "monthly"]);

export const BudgetEnforcementModeSchema = z.enum([
  "observe",
  "warn",
  "approval_required",
  "block",
]);

export const BudgetEstimateSourceSchema = z.enum([
  "model_rate",
  "provider_usage",
  "manual",
  "unknown",
]);

export const CreateBudgetPolicySchema = z.object({
  name: z.string().min(1).max(255),
  scope_type: BudgetPolicyScopeTypeSchema,
  scope_id: z.string().nullable().optional(),
  context_type: BudgetContextTypeSchema.nullable().optional(),
  context_id: z.string().nullable().optional(),
  provider_name: z.string().nullable().optional(),
  model_name: z.string().nullable().optional(),
  soft_limit_cents: z.number().int().min(0).nullable().optional(),
  hard_limit_cents: z.number().int().min(0).nullable().optional(),
  token_limit: z.number().int().min(0).nullable().optional(),
  window: BudgetPolicyWindowSchema,
  enforcement_mode: BudgetEnforcementModeSchema,
  is_active: z.boolean(),
});

export const UpdateBudgetPolicySchema = CreateBudgetPolicySchema.partial();

export const BudgetPolicyResponseSchema = CreateBudgetPolicySchema.extend({
  id: z.string(),
  scope_id: z.string().nullable(),
  context_type: BudgetContextTypeSchema.nullable(),
  context_id: z.string().nullable(),
  provider_name: z.string().nullable(),
  model_name: z.string().nullable(),
  soft_limit_cents: z.number().int().min(0).nullable(),
  hard_limit_cents: z.number().int().min(0).nullable(),
  token_limit: z.number().int().min(0).nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const EvaluateActionSchema = z.object({
  scope_id: z.string().nullable(),
  context_type: BudgetContextTypeSchema,
  context_id: z.string().min(1),
  action_type: BudgetActionTypeSchema,
  actor_type: BudgetActorTypeSchema,
  actor_id: z.string().nullable(),
  provider_name: z.string().nullable(),
  model_name: z.string().nullable(),
  expected_tokens: z.number().int().min(0).nullable(),
  correlation_id: z.string().min(1),
});

export const RecordUsageEventSchema = z.object({
  correlation_id: z.string().nullable(),
  scope_id: z.string().nullable(),
  context_type: BudgetContextTypeSchema,
  context_id: z.string().min(1),
  actor_type: BudgetActorTypeSchema,
  actor_id: z.string().nullable(),
  provider_name: z.string().nullable(),
  model_name: z.string().nullable(),
  input_tokens: z.number().int().min(0).nullable(),
  output_tokens: z.number().int().min(0).nullable(),
  total_tokens: z.number().int().min(0).nullable(),
  estimated_cost_cents: z.number().int().min(0).nullable(),
  estimate_source: BudgetEstimateSourceSchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
});

export const BudgetQuerySchema = z.object({
  scope_id: z.string().optional(),
  context_type: BudgetContextTypeSchema.optional(),
  context_id: z.string().optional(),
  provider_name: z.string().optional(),
  model_name: z.string().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const BudgetSummarySchema = z.object({
  scope_id: z.string().optional(),
  group_by: z.enum(["provider", "model", "scope", "context"]).optional(),
  window: BudgetSummaryWindowSchema.optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

export const BudgetSummaryRowSchema = z.object({
  key: z.string(),
  total_cents: z.string(),
  total_tokens: z.string(),
  count: z.string(),
  unpriced_count: z.string(),
});

export const BudgetTimelineRowSchema = z.object({
  bucket: z.string(),
  total_cents: z.string(),
  total_tokens: z.string(),
  count: z.string(),
});

export const BudgetUsageEventResponseSchema = z.object({
  id: z.string(),
  correlation_id: z.string().nullable(),
  scope_id: z.string().nullable(),
  context_type: BudgetContextTypeSchema,
  context_id: z.string(),
  actor_type: BudgetActorTypeSchema,
  actor_id: z.string().nullable(),
  provider_name: z.string().nullable(),
  model_name: z.string().nullable(),
  input_tokens: z.number().int().nullable(),
  output_tokens: z.number().int().nullable(),
  total_tokens: z.number().int().nullable(),
  estimated_cost_cents: z.number().int().nullable(),
  estimate_source: BudgetEstimateSourceSchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
  created_at: z.string(),
});

export * from "./cost-governance.types";
