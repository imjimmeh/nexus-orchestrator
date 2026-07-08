export enum ToolPolicyEffect {
  ALLOW = "allow",
  DENY = "deny",
  REQUIRE_APPROVAL = "require_approval",
  GUARDRAIL_DENY = "guardrail_deny",
}

export interface ToolPolicyAbsentArgumentMatcher {
  operator: "absent";
}

export type ToolPolicyArgumentMatcher =
  | ToolPolicyAbsentArgumentMatcher
  | string
  | null;

export interface ToolPolicyRule {
  id?: string;
  effect: ToolPolicyEffect;
  tool: string; // glob pattern
  arguments?: Record<string, ToolPolicyArgumentMatcher>;
  reason?: string;
}

export interface ToolPolicyDocument {
  default: ToolPolicyEffect;
  rules: (ToolPolicyRule | string)[];
}

export interface ToolPolicyDecision {
  effect: ToolPolicyEffect;
  matchedRuleId?: string;
  explanation?: string;
}

export function isToolPolicyEffect(value: unknown): value is ToolPolicyEffect {
  return (
    value === ToolPolicyEffect.ALLOW ||
    value === ToolPolicyEffect.DENY ||
    value === ToolPolicyEffect.REQUIRE_APPROVAL ||
    value === ToolPolicyEffect.GUARDRAIL_DENY
  );
}

export function isToolPolicyDocument(
  value: unknown,
): value is ToolPolicyDocument {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ToolPolicyDocument>;
  return (
    isToolPolicyEffect(candidate.default) &&
    Array.isArray(candidate.rules) &&
    candidate.rules.every(isToolPolicyRuleEntry)
  );
}

function isToolPolicyRuleEntry(
  value: unknown,
): value is ToolPolicyRule | string {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as Partial<ToolPolicyRule>;
  return (
    isToolPolicyEffect(candidate.effect) &&
    typeof candidate.tool === "string" &&
    candidate.tool.trim().length > 0 &&
    (candidate.arguments === undefined ||
      (!!candidate.arguments &&
        typeof candidate.arguments === "object" &&
        !Array.isArray(candidate.arguments)))
  );
}
