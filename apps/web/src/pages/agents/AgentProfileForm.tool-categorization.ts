interface CategorizedToolLists {
  allowed_tools: string[];
  denied_tools: string[];
  approval_required_tools: string[];
}

const EMPTY_TOOL_LISTS: CategorizedToolLists = {
  allowed_tools: [],
  denied_tools: [],
  approval_required_tools: [],
};

function categorizeStringRule(rule: string): CategorizedToolLists {
  const parts = rule.trim().split(/\s+/);
  if (parts.length < 2) {
    return { ...EMPTY_TOOL_LISTS };
  }
  const [effect, tool] = parts;
  if (effect === "allow") {
    return { ...EMPTY_TOOL_LISTS, allowed_tools: [tool] };
  }
  if (effect === "deny" || effect === "guardrail_deny") {
    return { ...EMPTY_TOOL_LISTS, denied_tools: [tool] };
  }
  if (effect === "require_approval") {
    return { ...EMPTY_TOOL_LISTS, approval_required_tools: [tool] };
  }
  return { ...EMPTY_TOOL_LISTS };
}

function categorizeStructuredRule(rule: {
  effect: string;
  tool: string;
}): CategorizedToolLists {
  if (rule.effect === "allow") {
    return { ...EMPTY_TOOL_LISTS, allowed_tools: [rule.tool] };
  }
  if (rule.effect === "deny" || rule.effect === "guardrail_deny") {
    return { ...EMPTY_TOOL_LISTS, denied_tools: [rule.tool] };
  }
  if (rule.effect === "require_approval") {
    return {
      ...EMPTY_TOOL_LISTS,
      approval_required_tools: [rule.tool],
    };
  }
  return { ...EMPTY_TOOL_LISTS };
}

function mergeCategorizedToolLists(
  accumulator: CategorizedToolLists,
  next: CategorizedToolLists,
): CategorizedToolLists {
  return {
    allowed_tools: [...accumulator.allowed_tools, ...next.allowed_tools],
    denied_tools: [...accumulator.denied_tools, ...next.denied_tools],
    approval_required_tools: [
      ...accumulator.approval_required_tools,
      ...next.approval_required_tools,
    ],
  };
}

function categorizeRule(rule: unknown): CategorizedToolLists {
  if (typeof rule === "string") {
    return categorizeStringRule(rule);
  }
  if (rule && typeof rule === "object" && "effect" in rule && "tool" in rule) {
    return categorizeStructuredRule(rule as { effect: string; tool: string });
  }
  return { ...EMPTY_TOOL_LISTS };
}

export function buildCategorizedToolLists(
  rules: unknown[] | undefined,
): CategorizedToolLists {
  if (!rules) {
    return { ...EMPTY_TOOL_LISTS };
  }
  return rules
    .map((rule) => categorizeRule(rule))
    .reduce(mergeCategorizedToolLists, { ...EMPTY_TOOL_LISTS });
}
