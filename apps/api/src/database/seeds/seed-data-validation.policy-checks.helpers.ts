import { normalizeToolPolicy } from '../../workflow/workflow-step-execution/step-support.helpers';
import type { IJob } from '@nexus/core';
import type {
  SeedValidationIssue,
  AgentToolPolicy,
  ParsedAgentSeed,
  ParsedWorkflowSeed,
} from './seed-data-validation.types';
import { addIssue, isLiteralReference } from './seed-data-validation.shared';
import { computeEffectiveCallableTools } from './seed-data-validation.effective-access.helpers';
import { extractPromptToolReferenceCandidates } from './seed-data-validation.prompt.helpers';

/**
 * Validate that tools referenced in job prompts are callable given the
 * combined policies of the agent profile, workflow, and job.
 *
 * This catches mismatches like:
 * - Agent prompt says "use invoke_agent_workflow" but workflow denies it
 * - Agent prompt says "use query_memory" but agent profile doesn't allow it
 * - Job permissions deny a tool that agent prompt needs
 */
export function validateJobPromptToolCallability(params: {
  job: IJob;
  jobPromptContent: string;
  agentName?: string;
  agentPolicy?: AgentToolPolicy;
  allKnownTools: Set<string>;
  filePath: string;
  workflowId?: string;
  errors: SeedValidationIssue[];
}): void {
  const {
    job,
    jobPromptContent,
    agentName,
    agentPolicy,
    allKnownTools,
    filePath,
    workflowId,
    errors,
  } = params;

  if (!agentName) {
    // No agent specified, can't validate callability
    return;
  }

  const effectiveCallableTools = computeEffectiveCallableTools({
    allKnownTools,
    agentPolicy,
    workflowPermissions: undefined,
    jobPermissions: job.permissions,
    policyStrategy: undefined,
  });

  const referencedTools =
    extractPromptToolReferenceCandidates(jobPromptContent);

  for (const toolName of referencedTools) {
    if (!allKnownTools.has(toolName)) {
      // Unknown tool - separate validation rule handles this
      continue;
    }

    if (effectiveCallableTools.has(toolName)) {
      // Tool is callable
      continue;
    }

    // Tool is known but not callable in this context
    const denialReason = getDenialReason(toolName, agentName, agentPolicy, job);

    addIssue(errors, {
      code: 'job-prompt-tool-not-callable',
      filePath,
      workflowId,
      message: `Job '${job.id}' prompt references tool '${toolName}' which is not callable (${denialReason || 'unknown reason'})`,
    });
  }
}

/**
 * Determine why a tool is not callable for a job.
 */
function getDenialReason(
  toolName: string,
  agentName: string,
  agentPolicy: AgentToolPolicy | undefined,
  job: IJob,
): string {
  if (agentPolicy) {
    const profileAllowed = computeEffectiveCallableTools({
      allKnownTools: new Set([toolName]),
      agentPolicy,
    });
    if (!profileAllowed.has(toolName)) {
      return `denied by agent profile '${agentName}' tool policy`;
    }
  }

  const jobPolicy = normalizeToolPolicy(job.permissions);
  if (jobPolicy.deny.has(toolName)) {
    return `denied by job '${job.id}' deny_tools policy`;
  }

  if (
    jobPolicy.allow.size > 0 &&
    !jobPolicy.allow.has('*') &&
    !jobPolicy.allow.has(toolName)
  ) {
    return `not in job '${job.id}' allow_tools list`;
  }

  return '';
}

/**
 * Validate that all tools an agent's assigned skills require
 * are actually callable when the agent is deployed in a workflow.
 */
export function validateAgentSkillCallability(params: {
  agentName: string;
  agentPolicy?: AgentToolPolicy;
  allKnownTools: Set<string>;
  skillRequiredTools: string[];
  errors: SeedValidationIssue[];
}): void {
  const { agentName, agentPolicy, allKnownTools, skillRequiredTools, errors } =
    params;

  const agentCallableTools = computeEffectiveCallableTools({
    allKnownTools,
    agentPolicy,
    workflowPermissions: undefined,
    jobPermissions: undefined,
    policyStrategy: undefined,
  });

  for (const tool of skillRequiredTools) {
    if (agentCallableTools.has(tool)) {
      continue;
    }

    if (!allKnownTools.has(tool)) {
      // Unknown tool - separate validation rule handles this
      continue;
    }

    addIssue(errors, {
      code: 'agent-skill-tool-not-callable',
      message: `Agent '${agentName}' assigned a skill requiring tool '${tool}', but this tool is not in the agent's allowed_tools`,
    });
  }
}

/**
 * Validate that all tools allowed by a job's permissions are also allowed by
 * the agent profile assigned to that job. The agent profile acts as a ceiling —
 * workflow/job permissions can only restrict, never expand — so a tool allowed
 * by the job but missing from the profile will be silently denied at runtime.
 *
 * This catches configuration errors like:
 * - Workflow step allows `open_war_room` but the architect-agent profile doesn't
 * - Job permissions grant `submit_war_room_signoff` but the profile omits it
 */
export function validateJobToolsAgainstProfile(params: {
  job: IJob;
  agentName?: string;
  agentPolicy?: AgentToolPolicy;
  allKnownTools: Set<string>;
  filePath: string;
  workflowId?: string;
  errors: SeedValidationIssue[];
}): void {
  const {
    job,
    agentName,
    agentPolicy,
    allKnownTools,
    filePath,
    workflowId,
    errors,
  } = params;

  if (!agentName || !agentPolicy) {
    return;
  }

  const jobAllowed = normalizeToolPolicy(job.permissions).allow;
  if (jobAllowed.has('*')) {
    return;
  }

  const profileAllowed = computeEffectiveCallableTools({
    allKnownTools,
    agentPolicy,
    workflowPermissions: undefined,
    jobPermissions: undefined,
    policyStrategy: undefined,
  });

  for (const tool of jobAllowed) {
    if (!allKnownTools.has(tool)) {
      continue;
    }

    if (profileAllowed.has(tool)) {
      continue;
    }

    addIssue(errors, {
      code: 'job-tool-not-in-profile',
      filePath,
      workflowId,
      agentName,
      message: `Job '${job.id}' allows tool '${tool}' but agent profile '${agentName}' does not — the profile acts as a ceiling so this tool will be denied at runtime`,
    });
  }
}

export function collectStaticAgentProfileRefs(job: IJob): string[] {
  const inputRecord =
    job.inputs && typeof job.inputs === 'object' ? job.inputs : null;
  const value = inputRecord?.agent_profile;
  if (typeof value !== 'string') {
    return [];
  }

  const normalized = value.trim();
  return normalized ? [normalized] : [];
}

export function validateJobToolsForProfile(params: {
  workflow: ParsedWorkflowSeed;
  job: IJob;
  agentMap: Map<string, ParsedAgentSeed>;
  knownToolNames: Set<string>;
  experimental: boolean;
  errors: SeedValidationIssue[];
  warnings: SeedValidationIssue[];
}): void {
  const agentProfileRefs = collectStaticAgentProfileRefs(params.job);
  if (agentProfileRefs.length === 0) {
    return;
  }

  for (const agentName of agentProfileRefs) {
    if (!isLiteralReference(agentName)) {
      continue;
    }

    const agent = params.agentMap.get(agentName);
    if (!agent) {
      continue;
    }

    validateJobToolsAgainstProfile({
      job: params.job,
      agentName: agent.name,
      agentPolicy: agent.toolPolicy,
      allKnownTools: params.knownToolNames,
      filePath: params.workflow.filePath,
      workflowId: params.workflow.workflowId,
      errors: params.experimental ? params.warnings : params.errors,
    });
  }
}
