import type { IJob, IToolPermissionPolicy } from '@nexus/core';
import { CONTAINER_SKILLS_ROOT } from '../../tool-runtime/skill-mounting.constants';
import {
  applyCompanionToolLogic,
  COMPANION_TOOLS,
} from './companion-tool.helpers';

export function formatSkillMountDiagnostics(params: {
  workflowRunId: string;
  jobId: string;
  stepId: string;
  agentProfile?: string;
  assignedSkillNames: string[];
  skillMountPath?: string | null;
}): string {
  const assignedLabel =
    params.assignedSkillNames.length > 0
      ? params.assignedSkillNames.join(', ')
      : 'none';
  const hostMountPath = params.skillMountPath ?? 'none';
  const profileName = params.agentProfile ?? 'none';

  return `Skill mount diagnostics: run=${params.workflowRunId} job=${params.jobId} step=${params.stepId} profile=${profileName} assigned=[${assignedLabel}] host_mount=${hostMountPath} container_mount=${CONTAINER_SKILLS_ROOT}`;
}

export function resolveAllowedSdkCodingToolsForAgent(params: {
  sdkCodingTools: readonly string[];
  job: IJob;
  agentProfile?: string;
  workflowPermissions?: IToolPermissionPolicy;
  applyPolicyToToolNames: (
    allowed: Set<string>,
    available: Set<string>,
    policy: IToolPermissionPolicy,
  ) => Set<string>;
  canProfileUseTool: (profileName: string, toolName: string) => boolean;
}): string[] {
  let candidates = new Set<string>(params.sdkCodingTools);

  if (params.job.tools && params.job.tools.length > 0) {
    const jobToolSet = new Set(params.job.tools);
    candidates = new Set(
      [...candidates].filter((tool) => jobToolSet.has(tool)),
    );
  }

  if (params.workflowPermissions) {
    candidates = params.applyPolicyToToolNames(
      candidates,
      candidates,
      params.workflowPermissions,
    );
  }

  if (params.job.permissions) {
    candidates = params.applyPolicyToToolNames(
      candidates,
      candidates,
      params.job.permissions,
    );
  }

  if (params.agentProfile) {
    const profileName = params.agentProfile;
    candidates = new Set(
      [...candidates].filter((tool) =>
        params.canProfileUseTool(profileName, tool),
      ),
    );
  }

  // Apply companion tool logic to ensure companion tools are included
  // when their primary tool is in the allowed set (e.g., wait_for_subagents
  // when spawn_subagent_async is allowed). This mirrors the logic in
  // step-support-tool-policy.helpers.ts for API callback tools.
  const availableTools = [
    ...params.sdkCodingTools,
    ...Object.keys(COMPANION_TOOLS),
  ];
  applyCompanionToolLogic({
    allowedTools: candidates,
    availableTools,
    jobPermissions: params.job.permissions,
    workflowPermissions: params.workflowPermissions,
  });

  return [...candidates];
}
