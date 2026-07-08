import type { RuleFormState } from "./toolApprovalRule.types";

export function validateToolApprovalRuleForm(
  form: RuleFormState,
): string | null {
  if (form.toolName.trim().length === 0) {
    return "Tool name is required.";
  }

  if (form.scopeType !== "global" && form.scopeId.trim().length === 0) {
    return "Scope ID is required for non-global scopes.";
  }

  return null;
}
