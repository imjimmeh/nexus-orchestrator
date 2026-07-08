/**
 * Shared execution tool-policy resolver used by both step and subagent provisioning.
 *
 * Implements the `requestedTools ∩ profileAllowed` intersection with companion-tool
 * propagation: if a primary tool survives the intersection, its companion tool is
 * automatically included even when the companion is not explicitly listed in the profile.
 */
import type { CompanionToolRule } from './execution-tool-policy.types';

export type { CompanionToolRule };

/**
 * Platform-level companion tool rules shared across step and subagent execution paths.
 * When `spawn_subagent_async` is granted, `wait_for_subagents` is automatically included
 * so agents can always wait for the subagents they spawn.
 */
export const DEFAULT_COMPANION_RULES: CompanionToolRule[] = [
  { primaryTool: 'spawn_subagent_async', companionTool: 'wait_for_subagents' },
];

/**
 * Resolves the final allowed tool-name list for an execution context.
 *
 * Algorithm:
 * 1. Compute the base intersection: `requestedTools ∩ profileAllowed`.
 * 2. For each companion rule, if the primary tool is in the intersection AND the
 *    companion tool appears in `requestedTools` (i.e. was offered by the platform),
 *    add the companion regardless of whether it is in `profileAllowed`.
 * 3. For each companion rule, if the primary tool is NOT in the intersection but the
 *    companion somehow made it in, remove the companion to preserve deny-default.
 */
export function resolveAllowedToolNamesForExecution(input: {
  requestedTools: string[];
  profileAllowed: ReadonlySet<string>;
  companionRules?: CompanionToolRule[];
}): string[] {
  const { requestedTools, profileAllowed, companionRules = [] } = input;

  // Step 1: base intersection
  const result = new Set<string>(
    requestedTools.filter((tool) => profileAllowed.has(tool)),
  );

  const requestedSet = new Set(requestedTools);

  // Step 2 & 3: apply companion rules
  for (const { primaryTool, companionTool } of companionRules) {
    if (result.has(primaryTool)) {
      // Primary survived — include companion if it was in the requested set
      if (requestedSet.has(companionTool)) {
        result.add(companionTool);
      }
    } else {
      // Primary was denied — ensure companion is also removed
      result.delete(companionTool);
    }
  }

  return [...result];
}
