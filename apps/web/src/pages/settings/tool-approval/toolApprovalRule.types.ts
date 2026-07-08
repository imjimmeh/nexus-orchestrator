import { ToolApprovalRuleEffect, ToolApprovalRuleScope } from "@/lib/api/tool-policy.types";

export type RuleFormState = {
  scopeType: ToolApprovalRuleScope;
  scopeId: string;
  toolName: string;
  effect: ToolApprovalRuleEffect;
  priority: string;
  expiresAt: string;
};

export type ScopeFilter = ToolApprovalRuleScope | "all";
export type EffectFilter = ToolApprovalRuleEffect | "all";
