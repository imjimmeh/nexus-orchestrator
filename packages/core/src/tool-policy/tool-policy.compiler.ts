import {
  ToolPolicyDocument,
  ToolPolicyEffect,
  ToolPolicyRule,
} from "./tool-policy.types";

export function compileLegacyArrays(
  allowed: string[] = [],
  denied: string[] = [],
  requiresApproval: string[] = [],
): ToolPolicyDocument {
  const rules: ToolPolicyRule[] = [];

  // Deny rules first (highest precedence in this specific legacy conversion)
  denied.forEach((tool) => rules.push({ effect: ToolPolicyEffect.DENY, tool }));

  // Require approval rules next
  requiresApproval.forEach((tool) =>
    rules.push({ effect: ToolPolicyEffect.REQUIRE_APPROVAL, tool }),
  );

  // Allow rules last
  allowed.forEach((tool) =>
    rules.push({ effect: ToolPolicyEffect.ALLOW, tool }),
  );

  return {
    default: ToolPolicyEffect.DENY,
    rules,
  };
}
