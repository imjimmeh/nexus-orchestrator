import type { ToolPolicyDocument } from '@nexus/core';

export type NormalizedProfileSeedDefinition = {
  name: string;
  system_prompt: string;
  tier_preference: 'light' | 'heavy';
  allowed_mount_aliases?: string[];
  denied_mount_aliases?: string[];
  allow_rw_mount_aliases?: string[];
  model_name?: string | null;
  provider_name?: string | null;
  provider_id?: string | null;
  provider_source?: 'global' | 'user' | 'scope' | null;
  assigned_skills?: string[];
  tool_policy?: ToolPolicyDocument;
  is_active?: boolean;
  supports_vision?: boolean;
};

export const OPTIONAL_PROFILE_ARRAY_FIELDS = [
  'assigned_skills',
  'allowed_mount_aliases',
  'denied_mount_aliases',
  'allow_rw_mount_aliases',
] as const;

export type OptionalProfileArrayField =
  (typeof OPTIONAL_PROFILE_ARRAY_FIELDS)[number];
