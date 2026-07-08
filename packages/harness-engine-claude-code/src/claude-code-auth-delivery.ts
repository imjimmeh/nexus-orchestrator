import type { RunnerProviderAuth } from "@nexus/core";
import { buildClaudeAuthEnv } from "./claude-code-auth-env.js";
import type {
  ClaudeAuthDelivery,
  ClaudeAuthDeliveryMode,
} from "./claude-code-auth-delivery.types.js";

const CREDENTIALS_FILENAME = ".credentials.json";

/**
 * Derives how to deliver auth to the Claude Code CLI. File delivery only
 * applies to subscription OAuth; API keys always go through the env var. Any
 * case that does not produce a credentials file falls back to env delivery, so
 * the proven behaviour is unchanged unless `file` mode is explicitly selected.
 */
export function buildClaudeAuthDelivery(
  auth: RunnerProviderAuth | undefined,
  mode: ClaudeAuthDeliveryMode,
  configDir: string,
): ClaudeAuthDelivery {
  if (mode !== "file" || !auth || auth.type !== "oauth") {
    return { env: buildClaudeAuthEnv(auth) };
  }

  const { accessToken, refreshToken, expiresAt } = auth.credential;
  if (!accessToken) {
    return { env: buildClaudeAuthEnv(auth) };
  }

  const contents = JSON.stringify({
    claudeAiOauth: { accessToken, refreshToken, expiresAt },
  });

  return {
    env: { CLAUDE_CONFIG_DIR: configDir },
    credentialsFile: {
      dir: configDir,
      path: `${configDir}/${CREDENTIALS_FILENAME}`,
      contents,
    },
  };
}
