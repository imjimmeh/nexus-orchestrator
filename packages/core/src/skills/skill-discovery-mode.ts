import type { SkillDiscoveryMode } from "./skill-discovery-mode.types";

export const DEFAULT_SKILL_DISCOVERY_MODE: SkillDiscoveryMode = "native";

/**
 * Resolve the effective skill discovery mode using a most-specific-wins
 * cascade: step → workflow → agent profile → default (`native`).
 * Each level is optional; null/undefined means "not set at this level".
 */
export function resolveSkillDiscoveryMode(inputs: {
  step?: SkillDiscoveryMode | null;
  workflow?: SkillDiscoveryMode | null;
  agentProfile?: SkillDiscoveryMode | null;
}): SkillDiscoveryMode {
  return (
    inputs.step ??
    inputs.workflow ??
    inputs.agentProfile ??
    DEFAULT_SKILL_DISCOVERY_MODE
  );
}
