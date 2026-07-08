import { ToolPolicyEffect, ToolPolicyRule } from "./tool-policy.types";

export function parseStringRule(ruleStr: string): ToolPolicyRule {
  const trimmed = ruleStr.trim();
  const match = trimmed.match(/^(\S+)\s+(\S+)(?:\s+(.*))?$/);

  if (!match) {
    throw new Error(`Invalid rule format: ${ruleStr}`);
  }

  const effectStr = match[1].toLowerCase();
  const tool = match[2];
  const argsStr = match[3];

  let effect: ToolPolicyEffect;

  switch (effectStr) {
    case "allow":
      effect = ToolPolicyEffect.ALLOW;
      break;
    case "deny":
      effect = ToolPolicyEffect.DENY;
      break;
    case "require_approval":
      effect = ToolPolicyEffect.REQUIRE_APPROVAL;
      break;
    case "guardrail_deny":
      effect = ToolPolicyEffect.GUARDRAIL_DENY;
      break;
    default:
      throw new Error(`Unknown effect: ${effectStr}`);
  }

  return {
    effect,
    tool,
    arguments: argsStr ? { command: argsStr.trim() } : undefined,
  };
}
