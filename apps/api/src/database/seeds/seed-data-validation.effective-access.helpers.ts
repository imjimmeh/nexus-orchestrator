import {
  ToolPolicyEffect,
  type IToolPermissionPolicy,
  type ToolPolicyDocument,
  type ToolPolicyStrategy,
} from '@nexus/core';
import { normalizeToolPolicy } from '../../workflow/workflow-step-execution/step-support.helpers';
import type { AgentToolPolicy } from './seed-data-validation.types';

/**
 * Compute the effective set of callable tools for a workflow step,
 * taking into account layered policies: agent profile → workflow → job.
 *
 * This is used during seed validation to detect mismatches where:
 * - An agent's prompt references a tool the agent can't access
 * - A workflow's prompt references a tool the workflow doesn't grant
 * - A job's permissions deny a tool that prompts depend on
 *
 * @param allKnownTools - All tools available in the system (capabilities + core aliases)
 * @param agentPolicy - Agent's allowed_tools / denied_tools from seed
 * @param workflowPermissions - Workflow-level tool permissions policy
 * @param jobPermissions - Job-level tool permissions policy
 * @param policyStrategy - 'profile_only' means workflow/job policies don't broaden agent access
 * @returns Set of tool names the agent can call in this job context
 */
export function computeEffectiveCallableTools(params: {
  allKnownTools: Set<string>;
  agentPolicy?: AgentToolPolicy;
  workflowPermissions?: IToolPermissionPolicy;
  jobPermissions?: IToolPermissionPolicy;
  policyStrategy?: ToolPolicyStrategy;
}): Set<string> {
  const {
    allKnownTools,
    agentPolicy,
    workflowPermissions,
    jobPermissions,
    policyStrategy,
  } = params;

  // Start with agent profile's allowed tools (or all tools if no profile/policy)
  let callable = resolveProfileAllowed(allKnownTools, agentPolicy);

  // Apply workflow-level policy (unless profile_only strategy)
  if (policyStrategy !== 'profile_only' && workflowPermissions) {
    callable = applyPolicyNarrowing(
      callable,
      allKnownTools,
      workflowPermissions,
    );
  }

  // Apply job-level policy (always narrows)
  if (jobPermissions) {
    callable = applyPolicyNarrowing(callable, allKnownTools, jobPermissions);
  }

  // set_job_output and yield_session are implicitly callable unless explicitly
  // denied by job policy — they are fundamental orchestration primitives.
  const jobDeny = normalizeToolPolicy(jobPermissions).deny;
  if (!jobDeny.has('set_job_output')) {
    callable.add('set_job_output');
  }
  if (!jobDeny.has('yield_session')) {
    callable.add('yield_session');
  }

  return callable;
}

/**
 * Resolve which tools an agent profile is allowed to use.
 * Respects allowed_tools/denied_tools from seed data.
 */
function resolveProfileAllowed(
  allKnownTools: Set<string>,
  agentPolicy?: AgentToolPolicy,
): Set<string> {
  if (!agentPolicy) {
    return new Set(allKnownTools);
  }

  let allowed = new Set<string>();

  const toolPolicy = agentPolicy.tool_policy;
  const hasToolPolicy =
    toolPolicy !== undefined &&
    toolPolicy !== null &&
    Array.isArray(toolPolicy.rules);

  if (hasToolPolicy) {
    allowed = resolveFromToolPolicy(allowed, allKnownTools, toolPolicy);
  } else {
    allowed = new Set(allKnownTools);
  }

  return allowed;
}

function applyStringRule(
  allowed: Set<string>,
  allKnownTools: Set<string>,
  rule: string,
): void {
  const parts = rule.trim().split(/\s+/);
  if (parts.length < 2) {
    return;
  }
  const [effect, tool] = parts;
  if (
    (effect === 'allow' || effect === 'require_approval') &&
    allKnownTools.has(tool)
  ) {
    allowed.add(tool);
  } else if (effect === 'deny' || effect === 'guardrail_deny') {
    allowed.delete(tool);
  }
}

function applyObjectRule(
  allowed: Set<string>,
  allKnownTools: Set<string>,
  rule: { effect: ToolPolicyEffect; tool: string },
): void {
  if (
    (rule.effect === ToolPolicyEffect.ALLOW ||
      rule.effect === ToolPolicyEffect.REQUIRE_APPROVAL) &&
    allKnownTools.has(rule.tool)
  ) {
    allowed.add(rule.tool);
  } else if (
    rule.effect === ToolPolicyEffect.DENY ||
    rule.effect === ToolPolicyEffect.GUARDRAIL_DENY
  ) {
    allowed.delete(rule.tool);
  }
}

function resolveFromToolPolicy(
  allowed: Set<string>,
  allKnownTools: Set<string>,
  toolPolicy: ToolPolicyDocument,
): Set<string> {
  if (toolPolicy.default === ToolPolicyEffect.ALLOW) {
    allowed = new Set(allKnownTools);
  }
  for (const rule of toolPolicy.rules) {
    if (typeof rule === 'string') {
      applyStringRule(allowed, allKnownTools, rule);
    } else {
      applyObjectRule(allowed, allKnownTools, rule);
    }
  }
  return allowed;
}

/**
 * Apply a policy to narrow the set of callable tools.
 * Policies can use allow_tools, deny_tools, or include patterns.
 * Note: set_job_output is excluded from policy filtering (it's implicit).
 */
function applyPolicyNarrowing(
  baseTools: Set<string>,
  allKnownTools: Set<string>,
  policy: IToolPermissionPolicy,
): Set<string> {
  // Remove set_job_output from filtering - it's handled specially
  const result = new Set(baseTools);
  result.delete('set_job_output');

  const normalizedPolicy = normalizeToolPolicy(policy);

  // If policy has explicit allowed tools, narrow to intersection
  if (normalizedPolicy.allow.size > 0) {
    if (!normalizedPolicy.allow.has('*')) {
      // Narrow to only the tools listed in the policy
      const policyAllowed = new Set<string>();
      for (const tool of normalizedPolicy.allow) {
        if (allKnownTools.has(tool)) {
          policyAllowed.add(tool);
        }
      }
      const filtered = new Set<string>();
      for (const t of result) {
        if (policyAllowed.has(t)) {
          filtered.add(t);
        }
      }
      result.clear();
      for (const t of filtered) {
        result.add(t);
      }
    }
  }

  // If policy has denied tools, remove them
  for (const tool of normalizedPolicy.deny) {
    result.delete(tool);
  }

  return result;
}
