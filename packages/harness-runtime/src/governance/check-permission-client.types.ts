// packages/harness-runtime/src/governance/check-permission-client.types.ts

import type { PermissionDecision } from "../engine/session-context.types.js";

export interface CheckPermissionConfig {
  apiBaseUrl: string;
  agentJwt: string;
  workflowRunId?: string;
  chatSessionId?: string;
  jobId?: string;
}

export type CheckPermission = (
  toolName: string,
  params: unknown,
) => Promise<PermissionDecision>;
