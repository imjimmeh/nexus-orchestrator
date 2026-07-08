import type { SkillDiscoveryMode } from "../skills/skill-discovery-mode.types";
import type { ToolPolicyDocument } from "../tool-policy/tool-policy.types";
import type { HarnessContributions } from "./harness-contributions.types";
import type { FallbackChainEntry } from "../ai-config/fallback-chain.types";
import type { RuntimeToolchainConfig } from "./runtime-toolchain.types";

export type AgentProfileSource =
  | "seeded"
  | "admin"
  | "agent_factory"
  | "repository";

export interface IAgentProfile {
  id: string;
  name: string;
  system_prompt?: string | null;
  model_name?: string | null;
  provider_name?: string | null;
  provider_id?: string | null;
  provider_source?: "global" | "user" | "scope" | null;
  thinking_level?: string | null;
  tier_preference?: string | null;
  supports_vision?: boolean | null;
  allowed_mount_aliases?: string[] | null;
  denied_mount_aliases?: string[] | null;
  allow_rw_mount_aliases?: string[] | null;
  assigned_skills?: string[] | null;
  skill_discovery_mode?: SkillDiscoveryMode | null;
  source: AgentProfileSource;
  created_by_profile?: string | null;
  created_by_workflow_run_id?: string | null;
  factory_context?: Record<string, unknown> | null;
  tool_policy?: ToolPolicyDocument | null;
  harness_contributions?: Partial<HarnessContributions> | null;
  fallback_chain?: FallbackChainEntry[] | null;
  runtime_toolchains?: RuntimeToolchainConfig | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}
