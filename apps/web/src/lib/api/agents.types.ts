/**
 * Agent profile + agent skill types — moved out of `./types.ts` so the rest
 * of the web API client can consume a stable surface while the legacy
 * `./types.ts` is incrementally depopulated by child-7.
 */

import type { RuntimeToolchainConfig } from "@nexus/core";
import type {
  AgentProfileSource,
  AgentSkillSource,
  Timestamps,
  TierPreference,
} from "./common.types";
import type { ToolPolicyDocument } from "./tool-policy.types";

export interface AgentProfile extends Timestamps {
  id: string;
  name: string;
  system_prompt?: string | null;
  model_name?: string | null;
  provider_name?: string | null;
  tier_preference?: TierPreference | null;
  tool_policy?: ToolPolicyDocument | null;
  harness_contributions?: Record<string, unknown> | null;
  source?: AgentProfileSource | null;
  created_by_profile?: string | null;
  created_by_workflow_run_id?: string | null;
  factory_context?: Record<string, unknown> | null;
  is_active: boolean;
  thinking_level?: string | null;
  fallback_chain?: Array<{ provider_name: string; model_name: string }> | null;
  runtime_toolchains?: RuntimeToolchainConfig | null;
}

export interface AgentSkill extends Timestamps {
  id: string;
  name: string;
  description: string;
  skill_markdown: string;
  compatibility?: string | null;
  metadata?: Record<string, unknown> | null;
  source?: AgentSkillSource | null;
  created_by_profile?: string | null;
  created_by_workflow_run_id?: string | null;
  version: number;
  is_active: boolean;
  scope?: {
    projects?: string[];
    agents?: string[];
    workflows?: string[];
  } | null;
}

export interface CreateAgentProfileRequest {
  name: string;
  system_prompt?: string;
  model_name?: string;
  provider_name?: string;
  tier_preference?: TierPreference;
  tool_policy?: ToolPolicyDocument;
  harness_contributions?: Record<string, unknown> | null;
  is_active?: boolean;
  thinking_level?: string | null;
  runtime_toolchains?: RuntimeToolchainConfig | null;
}

export interface UpdateAgentProfileRequest {
  name?: string;
  system_prompt?: string;
  model_name?: string;
  provider_name?: string;
  tier_preference?: TierPreference;
  tool_policy?: ToolPolicyDocument;
  harness_contributions?: Record<string, unknown> | null;
  is_active?: boolean;
  thinking_level?: string | null;
  runtime_toolchains?: RuntimeToolchainConfig | null;
}

export interface AgentSkillScope {
  projects?: string[];
  agents?: string[];
  workflows?: string[];
}

export interface CreateAgentSkillRequest {
  name: string;
  description: string;
  skill_markdown: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  is_active?: boolean;
  scope?: AgentSkillScope | null;
}

export interface UpdateAgentSkillRequest {
  name?: string;
  description?: string;
  skill_markdown?: string;
  compatibility?: string;
  metadata?: Record<string, unknown>;
  is_active?: boolean;
  scope?: AgentSkillScope | null;
}

export interface AgentSkillFile {
  path: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface UpsertAgentSkillFileRequest {
  relative_path: string;
  content?: string;
  content_base64?: string;
}

export interface ReplaceAgentProfileSkillsRequest {
  skill_ids: string[];
}

export interface ListAgentProfilesParams {
  /** Confines the listing to agent profiles visible at this scope node. */
  scopeNodeId?: string;
}