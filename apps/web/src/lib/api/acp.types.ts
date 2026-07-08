/**
 * ACP (Agent Communication Protocol) server domain types.
 *
 * Moved out of `./types.ts` so the rest of the web API client can consume a
 * stable surface while the legacy `./types.ts` is incrementally depopulated
 * by child-7.
 *
 * The ACP runtime enums (AcpServerStatus, AcpAuthType, AcpRunMode,
 * AcpAwaitPolicy) are re-exported as runtime values from `@nexus/core` so
 * downstream consumers can branch on them at runtime, not just reference
 * them as types.
 */

import {
  AcpAuthType,
  AcpAwaitPolicy,
  AcpRunMode,
  AcpServerStatus,
} from "@nexus/core";
import type {
  IAcpDiscoveredAgent,
  IAcpDiscoveredAgentSummary,
  IAcpReloadServerResult,
  IAcpServer,
  IAcpServerTestResult,
} from "@nexus/core";

type AcpServerDateFields =
  | "created_at"
  | "updated_at"
  | "last_connected_at"
  | "last_discovered_at";

export interface AcpServer extends Omit<IAcpServer, AcpServerDateFields> {
  created_at: string;
  updated_at: string;
  last_connected_at?: string | null;
  last_discovered_at?: string | null;
}

export type AcpServerTestResult = IAcpServerTestResult;
export type AcpDiscoveredAgent = IAcpDiscoveredAgent;
export type AcpDiscoveredAgentSummary = IAcpDiscoveredAgentSummary;
export type AcpReloadServerResult = IAcpReloadServerResult;

export { AcpServerStatus, AcpAuthType, AcpRunMode, AcpAwaitPolicy };

export interface CreateAcpServerRequest {
  name: string;
  url: string;
  auth_type: AcpAuthType;
  enabled?: boolean;
  auth_token?: string;
  headers?: Record<string, string>;
  include_agents?: string[];
  exclude_agents?: string[];
  timeout_ms?: number;
  connect_timeout_ms?: number;
  max_retries?: number;
  retry_backoff_ms?: number;
  default_run_mode?: AcpRunMode;
  await_policy?: AcpAwaitPolicy;
}

export type UpdateAcpServerRequest = Partial<CreateAcpServerRequest>;