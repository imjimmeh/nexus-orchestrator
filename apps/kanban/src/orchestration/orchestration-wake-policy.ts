import type {
  WakePolicy,
  ShouldWakeForTerminalRunInput,
  ShouldWakeForTerminalRunResult,
} from "./orchestration-wake-policy.types";

export type {
  WakePolicy,
  ShouldWakeForTerminalRunInput,
  ShouldWakeForTerminalRunResult,
};

const DEFAULT_WAKE_POLICY: WakePolicy = "slot_freed";
const KNOWN_POLICIES = new Set<WakePolicy>(["slot_freed", "every_terminal"]);

function normalize(value: unknown): WakePolicy | undefined {
  return typeof value === "string" && KNOWN_POLICIES.has(value as WakePolicy)
    ? (value as WakePolicy)
    : undefined;
}

/**
 * Resolve the effective wake policy. Precedence: project override → global
 * setting → default. Unknown or malformed values fall through to the default.
 */
export function resolveWakePolicy(
  projectOverride: unknown,
  globalSetting: unknown,
): WakePolicy {
  return (
    normalize(projectOverride) ??
    normalize(globalSetting) ??
    DEFAULT_WAKE_POLICY
  );
}

/**
 * Decide whether a terminal workflow run should request a CEO orchestration
 * wakeup. `every_terminal` always wakes (legacy behavior). Non-work-item runs
 * always wake (unchanged). Under `slot_freed`, a work-item run wakes only when
 * the owning item no longer consumes a dispatch slot.
 */
export function shouldWakeForTerminalRun(
  input: ShouldWakeForTerminalRunInput,
): ShouldWakeForTerminalRunResult {
  if (input.policy === "every_terminal") {
    return { wake: true };
  }
  if (input.workItemRunKind === "other") {
    return { wake: true };
  }
  if (input.itemStillActive) {
    return { wake: false, suppressReason: "slot_not_freed" };
  }
  return { wake: true };
}
