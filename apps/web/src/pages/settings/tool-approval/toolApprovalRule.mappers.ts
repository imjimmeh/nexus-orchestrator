import { CreateToolApprovalRuleRequest, ToolApprovalRule, UpdateToolApprovalRuleRequest } from "@/lib/api/tool-policy.types";
import type { RuleFormState } from "./toolApprovalRule.types";

const DEFAULT_RULE_PRIORITY = 100;

const defaultFormState: RuleFormState = {
  scopeType: "global",
  scopeId: "",
  toolName: "",
  effect: "require_approval",
  priority: "100",
  expiresAt: "",
};

function readInputDateTime(dateTimeIso: string | null): string {
  if (!dateTimeIso) {
    return "";
  }

  const date = new Date(dateTimeIso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toMutationPayload(form: RuleFormState): CreateToolApprovalRuleRequest {
  const trimmedScopeId = form.scopeId.trim();
  const parsedPriority = Number.parseInt(form.priority, 10);

  return {
    scopeType: form.scopeType,
    scopeId: trimmedScopeId.length > 0 ? trimmedScopeId : null,
    toolName: form.toolName.trim(),
    effect: form.effect,
    priority: Number.isFinite(parsedPriority)
      ? parsedPriority
      : DEFAULT_RULE_PRIORITY,
    expiresAt:
      form.expiresAt.trim().length > 0
        ? new Date(form.expiresAt).toISOString()
        : null,
  };
}

function toUpdatePayload(form: RuleFormState): UpdateToolApprovalRuleRequest {
  return toMutationPayload(form);
}

function toFormState(rule: ToolApprovalRule): RuleFormState {
  return {
    scopeType: rule.scopeType,
    scopeId: rule.scopeId ?? "",
    toolName: rule.toolName,
    effect: rule.effect,
    priority: String(rule.priority),
    expiresAt: readInputDateTime(rule.expiresAt),
  };
}

export { defaultFormState, toFormState, toMutationPayload, toUpdatePayload };
