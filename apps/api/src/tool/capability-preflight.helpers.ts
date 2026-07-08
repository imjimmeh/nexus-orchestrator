import type { IJob } from '@nexus/core';
import type { CapabilityManifestEntry } from '../capability-infra/capability-manifest.types';
import type {
  GovernanceContextType,
  PolicyAuthority,
} from './capability-governance.types';
import type { OrchestrationMode } from './capability-preflight.types';
import type { CapabilityDeniedReason } from './capability-preflight.types';

type RegisteredTool = {
  name: string;
  publication_status?: string | null;
};

export function isCapabilityRegistered(params: {
  toolName: string;
  selectedRegisteredTools: RegisteredTool[];
  runnerRuntimeTools: string[];
}): boolean {
  const inRegistry = params.selectedRegisteredTools.some(
    (tool) => tool.name === params.toolName,
  );

  // Runner-native tools are matched case-insensitively: the Claude Agent SDK
  // emits PascalCase built-in names (Bash/Read/Write) while the runner-native
  // set is lowercase (the PI naming convention). Both name the same host
  // capability, so casing must not gate them out.
  const requested = params.toolName.toLowerCase();
  const inRunnerTools = params.runnerRuntimeTools.some(
    (name) => name.toLowerCase() === requested,
  );

  return inRegistry || inRunnerTools;
}

export function buildNotRegisteredReason(
  toolName: string,
  policyAuthority?: PolicyAuthority,
  contextType?: GovernanceContextType,
): CapabilityDeniedReason {
  return {
    toolName,
    reasonCode: 'tool_not_registered',
    reason:
      'Tool is not available in the resolved runtime tier or runner capability set.',
    remediation:
      'Ensure the tool is seeded/mounted for this tier or use a runner-native capability.',
    policyAuthority,
    contextType,
  };
}

export function buildPolicyDeniedReason(
  toolName: string,
  policyAuthority: PolicyAuthority = 'workflow',
  contextType: GovernanceContextType = 'workflow_context',
): CapabilityDeniedReason {
  return {
    toolName,
    reasonCode: 'policy_denied',
    reason:
      'Tool is denied by agent profile allowed_tools or workflow/job policy.',
    remediation:
      'Update profile allowed_tools or workflow allow/deny policies for this job.',
    policyAuthority,
    contextType,
  };
}

export function buildNotPublishedReason(
  toolName: string,
  publicationStatus: string,
  policyAuthority?: PolicyAuthority,
  contextType?: GovernanceContextType,
): CapabilityDeniedReason {
  return {
    toolName,
    reasonCode: 'tool_not_published',
    reason: `Tool publication status is '${publicationStatus}' and not callable yet.`,
    remediation:
      'Validate and publish the tool candidate so publication_status becomes published.',
    policyAuthority,
    contextType,
  };
}

export function buildModeDeniedReason(
  toolName: string,
  contextType?: GovernanceContextType,
): CapabilityDeniedReason {
  return {
    toolName,
    reasonCode: 'mode_denied',
    reason: 'Current orchestration mode denies this mutating capability.',
    remediation:
      'Switch mode to supervised/autonomous or perform this action manually.',
    policyAuthority: 'mode_gate',
    contextType,
  };
}

export function buildRuleDeniedReason(
  toolName: string,
  contextType?: GovernanceContextType,
): CapabilityDeniedReason {
  return {
    toolName,
    reasonCode: 'rule_denied',
    reason: `Tool ${toolName} is denied by a dynamic approval rule.`,
    remediation: 'Update or remove the matching tool_approval_rule.',
    policyAuthority: 'dynamic_rule',
    contextType,
  };
}

export function findDeniedReason(
  denied: CapabilityDeniedReason[],
  toolName: string,
): CapabilityDeniedReason | undefined {
  return denied.find((entry) => entry.toolName === toolName);
}

export function selectRunnerRuntimeTools(
  job: IJob,
  runnerTools: string[],
): string[] {
  if (!Array.isArray(job.tools) || job.tools.length === 0) {
    return runnerTools;
  }

  const requested = new Set<string>(job.tools);
  return runnerTools.filter((name: string) => requested.has(name));
}

export function normalizeRequiredTools(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const names = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }

    names.add(trimmed);
  }

  return Array.from(names);
}

export function toMode(
  value: string | null | undefined,
): OrchestrationMode | null {
  if (
    value === 'autonomous' ||
    value === 'supervised' ||
    value === 'notifications_only'
  ) {
    return value;
  }
  return null;
}

export function resolveModeOutcome(
  mode: OrchestrationMode | null,
  mutatingAction: CapabilityManifestEntry['mutatingAction'],
): 'allow' | 'deny' | 'require_approval' {
  if (!mode || !mutatingAction) {
    return 'allow';
  }

  if (mode === 'autonomous') {
    return 'allow';
  }

  if (mode === 'supervised') {
    return 'require_approval';
  }

  return 'deny';
}

export function isValidUuid(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    trimmed,
  );
}

export function buildMissingProjectContextReason(
  toolName: string,
  contextType?: GovernanceContextType,
): CapabilityDeniedReason {
  return {
    toolName,
    reasonCode: 'missing_scope_context',
    reason:
      'This capability requires a valid project context, which is not available in the current session.',
    remediation:
      'In chat sessions, use project-agnostic collaboration tools (e.g., invite_agent_to_chat, mention_agent, open_war_room) or provide a project ID to the session.',
    policyAuthority: 'context_requirement',
    contextType: contextType ?? 'chat_context',
  };
}
