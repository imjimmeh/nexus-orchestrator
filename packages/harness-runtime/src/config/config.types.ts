// packages/harness-runtime/src/config/config.types.ts

import type { HarnessId } from "@nexus/core";

export interface HarnessEnvConfig {
  /** JWT token for authenticating with the telemetry gateway. */
  agentJwt: string;
  /** WebSocket URL of the Nexus telemetry gateway. */
  websocketUrl: string;
  /** Unique identifier for the current workflow step. */
  stepId: string;
  /** Unique identifier for the current workflow job. */
  jobId: string;
  /** Session identifier — sourced from WORKFLOW_RUN_ID or CHAT_SESSION_ID. */
  sessionId: string;
  /** Whether this session is a chat session. */
  isChatSession: boolean;
  /** Filesystem path where the session JSONL is mounted (if rehydrating). */
  sessionPath: string;
  /** Directory for tool extension source files. */
  extensionsPath: string;
  /** Working directory for the agent (defaults to /workspace). */
  workspacePath: string;
  /** Base URL of the Nexus HTTP API for tool callbacks. */
  apiBaseUrl: string;
  /** Identifier for this harness instance (e.g. "pi", "custom"). */
  harnessId: HarnessId;
}
