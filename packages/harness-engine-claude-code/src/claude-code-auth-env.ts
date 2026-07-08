import type { RunnerProviderAuth } from "@nexus/core";

/**
 * Derives the Claude Agent SDK auth env from resolved model.auth.
 * Delivered to the SDK in-process via query() options.env — never the container env.
 */
export function buildClaudeAuthEnv(
  auth: RunnerProviderAuth | undefined,
): Record<string, string> {
  if (!auth) return {};
  if (auth.type === "api_key") {
    return auth.apiKey ? { ANTHROPIC_API_KEY: auth.apiKey } : {};
  }
  if (auth.type === "oauth") {
    return auth.credential.accessToken
      ? { CLAUDE_CODE_OAUTH_TOKEN: auth.credential.accessToken }
      : {};
  }
  return {};
}
