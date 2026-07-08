import { normalizeToolPolicy } from './step-support.helpers';
import type { IToolPermissionPolicy } from '@nexus/core';

/**
 * Companion tool relationships for workflow orchestration tools.
 * If the primary tool is allowed, its companion tool is automatically included.
 */
export const COMPANION_TOOLS: Record<string, string> = {
  spawn_subagent_async: 'wait_for_subagents',
};

/**
 * Applies companion tool logic: if a primary tool is in the allowed set,
 * its companion tool is automatically included (e.g., spawn_subagent_async
 * implies wait_for_subagents).
 *
 * Explicit denial of the companion tool at the job or workflow level is respected.
 */
export function applyCompanionToolLogic(params: {
  allowedTools: Set<string>;
  availableTools: string[];
  jobPermissions?: IToolPermissionPolicy;
  workflowPermissions?: IToolPermissionPolicy;
}): void {
  const availableToolNames = new Set(params.availableTools);

  // Check if companion tool is explicitly denied at workflow level
  const workflowPolicy = normalizeToolPolicy(params.workflowPermissions);
  // Check if companion tool is explicitly denied at job level
  const jobPolicy = normalizeToolPolicy(params.jobPermissions);

  for (const [primaryTool, companionTool] of Object.entries(COMPANION_TOOLS)) {
    // If the primary tool is in allowedTools AND the companion tool is available
    if (
      params.allowedTools.has(primaryTool) &&
      availableToolNames.has(companionTool) &&
      // And the companion tool is not explicitly denied at workflow level
      !workflowPolicy.deny.has(companionTool) &&
      // And the companion tool is not explicitly denied at job level
      !jobPolicy.deny.has(companionTool)
    ) {
      params.allowedTools.add(companionTool);
    }
  }
}

/**
 * Checks if the companion tool should be included based on primary tool presence
 * and denial status at workflow and job levels.
 */
export function isCompanionToolAllowed(params: {
  primaryTool: string;
  companionTool: string;
  allowedTools: Set<string>;
  jobDeny: Set<string>;
  workflowDeny: Set<string>;
}): boolean {
  const companion = COMPANION_TOOLS[params.primaryTool];
  if (!companion || companion !== params.companionTool) {
    return false;
  }

  return (
    params.allowedTools.has(params.primaryTool) &&
    !params.jobDeny.has(params.companionTool) &&
    !params.workflowDeny.has(params.companionTool)
  );
}

/**
 * Returns all companion tools that should be added to the allowed set.
 */
export function getCompanionToolsToAdd(params: {
  allowedTools: Set<string>;
  availableTools: string[];
  jobDeny: Set<string>;
  workflowDeny: Set<string>;
}): string[] {
  const companionsToAdd: string[] = [];

  for (const [primaryTool, companionTool] of Object.entries(COMPANION_TOOLS)) {
    if (
      params.allowedTools.has(primaryTool) &&
      !params.allowedTools.has(companionTool) &&
      params.availableTools.includes(companionTool) &&
      !params.jobDeny.has(companionTool) &&
      !params.workflowDeny.has(companionTool)
    ) {
      companionsToAdd.push(companionTool);
    }
  }

  return companionsToAdd;
}
