import type { RuntimeToolchainConfig } from "@nexus/core";
import { Project } from "@/lib/api/projects.types";
import type { RuntimeToolchainsValue } from "./SettingsTab.hooks.types";

export const EMPTY_RUNTIME_TOOLCHAINS: RuntimeToolchainConfig = {
  toolchains: [],
};

export function useRuntimeToolchainsValue(
  project: Project | undefined,
): RuntimeToolchainsValue {
  return { value: project?.runtime_toolchains ?? EMPTY_RUNTIME_TOOLCHAINS };
}
