import { z } from "zod";

const TOOL_APPROVAL_RULE_SCOPES = [
  "global",
  "project",
  "agent_profile",
  "workflow_run",
  "chat_session",
  "scope_node",
] as const;

const TOOL_APPROVAL_RULE_EFFECTS = [
  "allow",
  "deny",
  "require_approval",
] as const;

const ARGUMENT_PATTERN_OPERATORS = ["eq", "contains", "regex", "glob"] as const;

const toOptionalDateOrNull = (value: unknown): Date | null | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || value === "") {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }
  return undefined;
};

export const argumentPatternSchema = z.object({
  path: z.string(),
  operator: z.enum(ARGUMENT_PATTERN_OPERATORS),
  value: z.string(),
});

export const createToolApprovalRuleSchema = z.object({
  scopeType: z.enum(TOOL_APPROVAL_RULE_SCOPES),
  scopeId: z.string().nullable().optional(),
  toolName: z.string(),
  effect: z.enum(TOOL_APPROVAL_RULE_EFFECTS),
  priority: z.coerce.number().int().min(0).optional(),
  argumentPatterns: z.array(argumentPatternSchema).optional().nullable(),
  createdBy: z.string().optional().nullable(),
  expiresAt: z
    .preprocess((value) => toOptionalDateOrNull(value), z.date().nullable())
    .optional(),
});

export const updateToolApprovalRuleSchema = z.object({
  scopeType: z.enum(TOOL_APPROVAL_RULE_SCOPES).optional(),
  scopeId: z.string().nullable().optional(),
  toolName: z.string().optional(),
  effect: z.enum(TOOL_APPROVAL_RULE_EFFECTS).optional(),
  priority: z.coerce.number().int().min(0).optional(),
  argumentPatterns: z.array(argumentPatternSchema).optional().nullable(),
  expiresAt: z
    .preprocess((value) => toOptionalDateOrNull(value), z.date().nullable())
    .optional(),
});

export const submitResourceArtifactInputSchema = z.object({
  scope_id: z.string(),
  context_id: z.string(),
  status: z.enum(["resolved"]),
  feedback: z.string().optional(),
});

export type ArgumentPatternInput = z.infer<typeof argumentPatternSchema>;
export type CreateToolApprovalRuleRequest = z.infer<
  typeof createToolApprovalRuleSchema
>;
export type UpdateToolApprovalRuleRequest = z.infer<
  typeof updateToolApprovalRuleSchema
>;
