import type { ToolPolicyDocument } from '@nexus/core';

export interface AgentProfileSeedDefinition {
  name: string;
  system_prompt: string;
  tier_preference: 'light' | 'heavy';
  supports_vision?: boolean;
  allowed_mount_aliases?: string[];
  denied_mount_aliases?: string[];
  allow_rw_mount_aliases?: string[];
  model_name?: string | null;
  provider_name?: string | null;
  provider_id?: string | null;
  provider_source?: 'global' | 'user' | 'scope' | null;
  tool_policy?: ToolPolicyDocument;
  assigned_skills?: string[];
  is_active?: boolean;
}
