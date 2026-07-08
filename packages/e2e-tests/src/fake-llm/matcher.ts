// packages/e2e-tests/src/fake-llm/matcher.ts
import type { CanonicalRequest, RuleMatch, Scenario, Turn } from "./types.js";

function matchesModel(
  matchModel: RuleMatch["model"],
  requestModel: string,
): boolean {
  if (matchModel === undefined) return true;
  return matchModel instanceof RegExp
    ? matchModel.test(requestModel)
    : requestModel === matchModel;
}

export function matchesRule(
  match: RuleMatch,
  request: CanonicalRequest,
  callIndex: number,
): boolean {
  if (!matchesModel(match.model, request.model)) return false;
  if (
    match.systemIncludes !== undefined &&
    !request.system.includes(match.systemIncludes)
  ) {
    return false;
  }
  if (match.userIncludes !== undefined) {
    const lastUser = [...request.messages]
      .reverse()
      .find((message) => message.role === "user");
    if (!lastUser || !lastUser.text.includes(match.userIncludes)) return false;
  }
  if (
    match.hasTool !== undefined &&
    !request.tools.some((tool) => tool.name === match.hasTool)
  ) {
    return false;
  }
  if (
    match.toolResultFor !== undefined &&
    !request.messages.some(
      (message) =>
        message.role === "tool" && message.toolName === match.toolResultFor,
    )
  ) {
    return false;
  }
  if (match.callIndex !== undefined && match.callIndex !== callIndex) {
    return false;
  }
  return true;
}

export function selectResponse(
  scenario: Scenario,
  request: CanonicalRequest,
  callIndex: number,
): Turn[] | null {
  for (const rule of scenario.rules) {
    if (matchesRule(rule.match, request, callIndex)) {
      return rule.respond;
    }
  }
  return null;
}
