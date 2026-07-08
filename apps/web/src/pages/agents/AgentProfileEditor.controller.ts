import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { AgentProfile } from "@/lib/api/agents.types";

import { ToolPolicyDocument } from "@/lib/api/tool-policy.types";

type AgentProfileEditorSubmitData = {
  name: string;
  provider_name?: string;
  model_name?: string;
  tier_preference?: "light" | "heavy" | "";
  allowed_tools: string[];
  denied_tools: string[];
  approval_required_tools: string[];
  skill_ids: string[];
  system_prompt?: string;
  harness_contributions?: Record<string, unknown> | null;
  fallback_chain: Array<{ provider_name: string; model_name: string }>;
  runtime_toolchains: RuntimeToolchainConfig;
};

type AgentProfileMutation = {
  mutateAsync: (params: {
    id: string;
    data: {
      name: string;
      provider_name?: string;
      model_name?: string;
      tier_preference?: "light" | "heavy";
      tool_policy?: ToolPolicyDocument;
      system_prompt?: string;
      harness_contributions?: Record<string, unknown> | null;
      fallback_chain?: Array<{ provider_name: string; model_name: string }>;
      runtime_toolchains?: RuntimeToolchainConfig;
    };
  }) => Promise<unknown>;
  isPending: boolean;
};

type AgentProfileCreateMutation = {
  mutateAsync: (params: {
    name: string;
    provider_name?: string;
    model_name?: string;
    tier_preference?: "light" | "heavy";
    tool_policy?: ToolPolicyDocument;
    system_prompt?: string;
    harness_contributions?: Record<string, unknown> | null;
    fallback_chain?: Array<{ provider_name: string; model_name: string }>;
    runtime_toolchains?: RuntimeToolchainConfig;
    is_active: boolean;
  }) => Promise<{ id: string }>;
  isPending: boolean;
};

type ReplaceProfileSkillsMutation = {
  mutateAsync: (params: {
    profileId: string;
    skillIds: string[];
  }) => Promise<unknown>;
  isPending: boolean;
};

interface UseAgentProfileEditorControllerParams {
  isEditMode: boolean;
  profile: AgentProfile | undefined;
  createProfile: AgentProfileCreateMutation;
  updateProfile: AgentProfileMutation;
  replaceProfileSkills: ReplaceProfileSkillsMutation;
}

export function buildProfileData(data: AgentProfileEditorSubmitData) {
  const rules: ToolPolicyDocument["rules"] = [];

  for (const tool of data.allowed_tools) {
    rules.push({ effect: "allow", tool });
  }
  for (const tool of data.denied_tools) {
    rules.push({ effect: "deny", tool });
  }
  for (const tool of data.approval_required_tools) {
    rules.push({ effect: "require_approval", tool });
  }

  return {
    name: data.name,
    provider_name: data.provider_name || undefined,
    model_name: data.model_name || undefined,
    tier_preference: (data.tier_preference || undefined) as
      | "light"
      | "heavy"
      | undefined,
    tool_policy: {
      default: "deny" as const,
      rules,
    },
    system_prompt: data.system_prompt || undefined,
    harness_contributions: data.harness_contributions ?? null,
    fallback_chain:
      data.fallback_chain.length > 0 ? data.fallback_chain : undefined,
    runtime_toolchains: data.runtime_toolchains?.toolchains.length
      ? data.runtime_toolchains
      : undefined,
  };
}

export function useAgentProfileEditorController(
  params: UseAgentProfileEditorControllerParams,
) {
  const navigate = useNavigate();

  const handleSubmit = useCallback(
    async (data: AgentProfileEditorSubmitData) => {
      if (params.isEditMode && params.profile) {
        await params.updateProfile.mutateAsync({
          id: params.profile.id,
          data: buildProfileData(data),
        });
        await params.replaceProfileSkills.mutateAsync({
          profileId: params.profile.id,
          skillIds: data.skill_ids,
        });
      } else {
        const created = await params.createProfile.mutateAsync({
          ...buildProfileData(data),
          is_active: true,
        });
        if (data.skill_ids.length > 0) {
          await params.replaceProfileSkills.mutateAsync({
            profileId: created.id,
            skillIds: data.skill_ids,
          });
        }
      }

      navigate("/agents");
    },
    [
      params.createProfile,
      params.isEditMode,
      params.profile,
      params.replaceProfileSkills,
      params.updateProfile,
      navigate,
    ],
  );

  return {
    handleSubmit,
    onCancel: () => navigate("/agents"),
    isSubmitting:
      params.createProfile.isPending ||
      params.updateProfile.isPending ||
      params.replaceProfileSkills.isPending,
  };
}
