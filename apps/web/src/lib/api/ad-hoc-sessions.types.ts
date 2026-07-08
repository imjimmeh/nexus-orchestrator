/**
 * Ad-hoc session domain types — sessions launched from the new-session UI
 * outside of any chat-session wrapper.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 */

import type { WorkflowRunStatus } from "./common.types";

export interface CreateAdHocSessionRequest {
  agentProfileName: string;
  projectId?: string;
  initialMessage: string;
}

export interface CreateAdHocSessionResponse {
  runId: string;
}

export interface AdHocSessionListItem {
  runId: string;
  agentProfileName: string;
  projectId: string | null;
  projectName: string | null;
  status: WorkflowRunStatus;
  displayName: string;
  initialMessage: string;
  createdAt: string;
  completedAt: string | null;
}