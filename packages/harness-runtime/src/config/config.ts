/**
 * Configuration module for the harness runtime execution plane.
 *
 * Reads required environment variables injected by the container orchestrator.
 * Secrets (API keys, model config) are NOT read from env — they arrive
 * via the WebSocket `configure` handshake (see orchestrator-client.ts).
 */

import {
  CONTAINER_EXTENSIONS_PATH,
  CONTAINER_SESSION_PATH,
  isHarnessId,
  type HarnessId,
} from "@nexus/core";
import type { HarnessEnvConfig } from "./config.types.js";

export type { HarnessEnvConfig } from "./config.types.js";

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

function requireEnv(
  env: Record<string, string | undefined>,
  name: string,
): string {
  const value = env[name];
  if (!value) {
    throw new ConfigValidationError(`${name} environment variable is required`);
  }
  return value;
}

function resolveHarnessId(rawValue: string): HarnessId {
  if (!isHarnessId(rawValue)) {
    throw new ConfigValidationError(
      `HARNESS_ID "${rawValue}" is not a valid harness ID`,
    );
  }
  return rawValue;
}

/**
 * Load and validate environment variables available inside the container.
 * Throws {@link ConfigValidationError} if any required variable is missing.
 */
export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): HarnessEnvConfig {
  const agentJwt = env.AGENT_JWT;
  if (!agentJwt) {
    throw new ConfigValidationError(
      "AGENT_JWT environment variable is required",
    );
  }

  const stepId = env.STEP_ID;
  if (!stepId) {
    throw new ConfigValidationError("STEP_ID environment variable is required");
  }
  const jobId = env.JOB_ID ?? stepId;

  const sessionId = env.WORKFLOW_RUN_ID ?? env.CHAT_SESSION_ID;
  if (!sessionId) {
    throw new ConfigValidationError(
      "WORKFLOW_RUN_ID or CHAT_SESSION_ID environment variable is required",
    );
  }

  const isChatSession = !!env.CHAT_SESSION_ID && !env.WORKFLOW_RUN_ID;

  return {
    agentJwt,
    websocketUrl: env.WEBSOCKET_URL ?? "http://localhost:3001",
    stepId,
    jobId,
    sessionId,
    isChatSession,
    sessionPath: env.SESSION_PATH ?? CONTAINER_SESSION_PATH,
    extensionsPath: env.EXTENSIONS_PATH ?? CONTAINER_EXTENSIONS_PATH,
    workspacePath: env.WORKSPACE_PATH ?? "/workspace",
    apiBaseUrl: env.API_BASE_URL ?? "http://localhost:3000",
    harnessId: resolveHarnessId(requireEnv(env, "HARNESS_ID")),
  };
}
