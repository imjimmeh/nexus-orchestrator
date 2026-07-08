import type {
  IToolPermissionPolicy,
  ToolPolicyStrategy,
  IJob,
} from '@nexus/core';
import { normalizeToolPolicy } from './step-support.helpers';
import {
  resolveAllowedToolNamesForExecution,
  DEFAULT_COMPANION_RULES,
} from '../workflow-execution-tools/execution-tool-policy.helpers';

export function resolveAllowedToolNamesForStep(params: {
  tools: Array<{ name: string }>;
  job: IJob;
  workflowPermissions?: IToolPermissionPolicy;
  agentProfile?: string;
  policyStrategy?: ToolPolicyStrategy;
  canProfileUseTool: (agentProfile: string, toolName: string) => boolean;
  applyPolicyToToolNames: (
    baseToolNames: Set<string>,
    candidateToolNames: Set<string>,
    policy: unknown,
  ) => Set<string>;
}): Set<string> {
  const allCandidateNames = new Set<string>(params.tools.map((t) => t.name));
  if (params.job.output_contract) {
    allCandidateNames.add('set_job_output');
  }
  const allowedByProfile = resolveAllowedByProfile(params);

  if (allCandidateNames.has('set_job_output')) {
    allowedByProfile.add('set_job_output');
  }

  const workflowScoped =
    params.policyStrategy === 'profile_only'
      ? allowedByProfile
      : params.applyPolicyToToolNames(
          allowedByProfile,
          allCandidateNames,
          params.workflowPermissions,
        );

  const jobScoped = params.applyPolicyToToolNames(
    workflowScoped,
    allCandidateNames,
    params.job.permissions,
  );

  const shouldPreserveSetJobOutput =
    allCandidateNames.has('set_job_output') &&
    (params.policyStrategy === 'profile_only' ||
      !isToolExplicitlyDenied(params.workflowPermissions)) &&
    !isToolExplicitlyDenied(params.job.permissions);
  if (shouldPreserveSetJobOutput) {
    jobScoped.add('set_job_output');
  }

  // Expand jobScoped to include companion tools that survived job/workflow policy.
  // A companion is eligible when its primary is in jobScoped, the companion is in the
  // candidate pool, and it is not subject to an explicit deny rule at either layer.
  // This ensures companions survive the final profile-intersection even when the profile
  // did not enumerate them explicitly.
  expandCompanionsInJobScoped(
    jobScoped,
    allCandidateNames,
    params.job.permissions,
    params.workflowPermissions,
  );

  if (!params.agentProfile) {
    return jobScoped;
  }

  return new Set(
    resolveAllowedToolNamesForExecution({
      requestedTools: [...jobScoped],
      profileAllowed: allowedByProfile,
      companionRules: DEFAULT_COMPANION_RULES,
    }),
  );
}

function isToolExplicitlyDenied(
  policy: IToolPermissionPolicy | undefined,
): boolean {
  const { deny } = normalizeToolPolicy(policy);
  return deny.has('set_job_output') || deny.has('*');
}

/**
 * Expands jobScoped to include companion tools that should survive the final profile
 * intersection. A companion is added when its primary tool is already in jobScoped, the
 * companion is in the candidate pool, and neither layer explicitly denies it. This allows
 * the downstream `resolveAllowedToolNamesForExecution` intersection to propagate companion
 * tools correctly even when the agent profile did not enumerate them.
 */
function expandCompanionsInJobScoped(
  jobScoped: Set<string>,
  allCandidateNames: Set<string>,
  jobPermissions?: IToolPermissionPolicy,
  workflowPermissions?: IToolPermissionPolicy,
): void {
  const jobDeny = jobPermissions
    ? normalizeToolPolicy(jobPermissions).deny
    : new Set<string>();
  const workflowDeny = workflowPermissions
    ? normalizeToolPolicy(workflowPermissions).deny
    : new Set<string>();

  for (const { primaryTool, companionTool } of DEFAULT_COMPANION_RULES) {
    if (
      jobScoped.has(primaryTool) &&
      allCandidateNames.has(companionTool) &&
      !jobDeny.has(companionTool) &&
      !workflowDeny.has(companionTool)
    ) {
      jobScoped.add(companionTool);
    }
  }
}

/**
 * Resolve the effective allowed tool-name set for a single policy layer
 * (workflow or job permissions). Extracted from `StepSupportService` so the
 * service stays under the file-level `max-lines` cap; the logic is pure (no
 * service state) and belongs alongside the other tool-policy resolvers.
 */
export function applyPolicyToToolNames(
  baseToolNames: Set<string>,
  candidateToolNames: Set<string>,
  policy: unknown,
): Set<string> {
  const { allow, deny } = normalizeToolPolicy(policy);
  let resolved: Set<string>;

  if (allow.size === 0) {
    resolved = new Set<string>(baseToolNames);
  } else if (allow.has('*')) {
    resolved = new Set<string>([...baseToolNames, ...candidateToolNames]);
  } else {
    resolved = resolveAllowedFromPolicy(
      allow,
      baseToolNames,
      candidateToolNames,
    );
  }

  if (deny.has('*')) {
    return new Set<string>();
  }
  for (const toolName of deny) {
    resolved.delete(toolName);
  }
  return resolved;
}

function resolveAllowedFromPolicy(
  allow: Set<string>,
  baseToolNames: Set<string>,
  candidateToolNames: Set<string>,
): Set<string> {
  const resolved = new Set<string>();
  for (const toolName of baseToolNames) {
    if (allow.has(toolName)) {
      resolved.add(toolName);
    }
  }

  for (const toolName of allow) {
    if (candidateToolNames.has(toolName)) {
      resolved.add(toolName);
    }
    const colonIdx = toolName.indexOf(':');
    if (colonIdx > 0) {
      const baseName = toolName.slice(0, colonIdx);
      if (baseToolNames.has(baseName) || candidateToolNames.has(baseName)) {
        resolved.add(baseName);
      }
    }
  }

  return resolved;
}

function resolveAllowedByProfile(params: {
  tools: Array<{ name: string }>;
  agentProfile?: string;
  canProfileUseTool: (agentProfile: string, toolName: string) => boolean;
}): Set<string> {
  const allCandidateNames = new Set<string>(params.tools.map((t) => t.name));
  if (!params.agentProfile) {
    return new Set<string>(allCandidateNames);
  }

  const allowedByProfile = new Set<string>();
  for (const tool of params.tools) {
    if (params.canProfileUseTool(params.agentProfile, tool.name)) {
      allowedByProfile.add(tool.name);
    }
  }

  return allowedByProfile;
}
