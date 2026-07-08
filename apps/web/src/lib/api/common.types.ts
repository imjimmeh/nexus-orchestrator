 
/**
 * Common & foundational types shared across the web API client.
 *
 * Extracted from `./types.ts` so sibling extraction children (auth, oauth,
 * workflows, etc.) can consume a stable surface. `child-7` will sweep the
 * re-exports in `./types.ts` once the rest of the extraction work lands.
 */

// === Re-exports: shared OAuth contract (single source of truth: @nexus/core) ===
// OAuth login + provider-OAuth schemas live in @nexus/core so backend and
// frontend share the same types. Grouped together so reviewers can scan
// them at a glance.
export type {
  ProviderOAuthStatusValue,
  ProviderOAuthAuthorizeRequest,
  ProviderOAuthAuthorizeResponse,
  ProviderOAuthCallbackRequest,
  ProviderOAuthStatus,
  OAuthModality,
  OAuthSessionStatusValue,
  OAuthStartResult,
  OAuthSessionStatus,
} from "@nexus/core";

// === Re-exports: shared Kanban work-item contract ===
export type {
  PaginatedWorkItems,
  WorkItemQuery,
} from "@nexus/kanban-contracts";

import type {
  ProviderOwnerType,
  WorkflowRunStatus as CoreWorkflowRunStatus,
} from "@nexus/core";
import type { EventLedgerRecord } from "./event-ledger.types";

export type AuthType = "api_key" | "oauth";

export type ConfigOwnerType = ProviderOwnerType;

export type TierPreference = "light" | "heavy";
export type AgentProfileSource = "seeded" | "admin" | "agent_factory";
export type AgentSkillSource = "admin" | "agent_factory" | "imported";
export type WorkflowRunStatus = CoreWorkflowRunStatus;

export interface Timestamps {
  created_at: string;
  updated_at: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta?: {
    pagination: {
      total: number;
      page?: number;
      limit: number;
      offset?: number;
      totalPages?: number;
    };
  };
}

export interface EventLedgerPaginatedResponse {
  success: boolean;
  data: EventLedgerRecord[];
  meta?: {
    total: number;
    limit: number;
    offset: number;
  };
}

export interface ListQueryParams {
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export interface FileContent {
  content: string;
  path: string;
  branch: string;
  size: number;
  lastCommit?: {
    hash: string;
    message: string;
    author: string;
    date: string;
  };
}