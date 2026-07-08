import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isTerminalWorkflowRunStatus, ToolPolicyEffect } from '@nexus/core';
import Docker from 'dockerode';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import { mergeSdkNativeToolsForSubagent } from '../workflow-subagents/subagent-tool-merge.helpers';
import { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import { ExecutionContextResolverService } from '../execution-context-resolver.service';
import { AgentProfileRepository } from '../../ai-config/database/repositories/agent-profile.repository';
import { ToolPolicyEvaluatorService } from '../../capability-governance/tool-policy-evaluator.service';
import { ToolMountingService } from '../../tool-runtime/tool-mounting.service';
import {
  resolveAllowedToolNamesForExecution,
  DEFAULT_COMPANION_RULES,
} from '../workflow-execution-tools/execution-tool-policy.helpers';
import type { WorkflowLifecycleStage } from '../workflow-stage-skill-policy.service.types';
import type {
  SubagentSpawnAsyncBody,
  SubagentWaitBody,
} from './workflow-runtime-tools.controller.types';
import { extractSubagentModelCascade } from '../workflow-step-execution/step-support.helpers';

interface AgentUserContext {
  userId?: string;
  stepId?: string;
  jobId?: string;
  agentProfileName?: string;
}

interface AgentExecutionContext {
  workflowRunId: string;
  jobId: string;
  stepId?: string;
  lifecycleStage: WorkflowLifecycleStage | null;
  stateVariables: Record<string, unknown>;
}

@Injectable()
export class WorkflowRuntimeSubagentToolsService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepository: IWorkflowRunRepository,
    private readonly subagentOrchestrator: SubagentOrchestratorService,
    private readonly stageSkillPolicy: WorkflowStageSkillPolicyService,
    private readonly executionContextResolver: ExecutionContextResolverService,
    private readonly agentProfileRepo: AgentProfileRepository,
    private readonly toolPolicyEvaluator: ToolPolicyEvaluatorService,
    private readonly toolMounting: ToolMountingService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
  ) {}

  async spawnSubagentAsync(
    user: AgentUserContext | undefined,
    params: SubagentSpawnAsyncBody,
  ): Promise<Record<string, unknown>> {
    if (user?.agentProfileName && params.agent_profile) {
      const callerProfile = await this.agentProfileRepo.findByName(
        user.agentProfileName,
      );
      if (callerProfile?.tool_policy) {
        const decision = this.toolPolicyEvaluator.evaluate(
          'spawn_subagent_async',
          { agent_profile: params.agent_profile },
          callerProfile.tool_policy,
        );
        if (
          decision.effect === ToolPolicyEffect.DENY ||
          decision.effect === ToolPolicyEffect.GUARDRAIL_DENY
        ) {
          throw new ForbiddenException(
            `Agent profile '${user.agentProfileName}' is not permitted to spawn subagent with profile '${params.agent_profile}'`,
          );
        }
      }
    }

    const context = await this.resolveExecutionContext(user);
    const parentContainerId = await this.resolveParentContainerId(context);
    const assignedFiles = normalizeStringListInput(params.assigned_files);

    const paramsRest = this.omitSubagentListFields(params);
    const normalizedTools = mergeSdkNativeToolsForSubagent(
      normalizeStringListInput(params.tools) ?? [],
    );
    const profileFilteredTools = resolveProfileAllowedToolsForSubagent(
      normalizedTools,
      params.agent_profile,
      this.toolMounting,
    );
    const modelCascade = extractSubagentModelCascade(context.stateVariables);
    const executionId = await this.subagentOrchestrator.spawn(
      parentContainerId,
      {
        ...paramsRest,
        ...modelCascade,
        tier: 'heavy',
        inherit_host_mounts: paramsRest.inherit_host_mounts ?? true,
        workflowRunId: context.workflowRunId,
        parent_job_id: context.jobId,
        // The spawning step's YAML id — threaded through to the effective
        // skill resolver (`resolveSubagentProfileAndAssignedSkills`) so
        // step-scoped `workflow_skill_bindings` and step-level YAML
        // `inputs.skills` reach this subagent the same way they reach the
        // step executor (FU-5).
        parent_step_id: context.stepId,
        lifecycle_stage: context.lifecycleStage,
        ...(assignedFiles !== undefined
          ? { assigned_files: assignedFiles }
          : {}),
        tools: profileFilteredTools,
        // Tie the spawn to the originating step so the duplicate-spawn guard
        // (resolveActiveExecutions) can detect and reject a second spawn for
        // the same step before the first one reaches a terminal state.
        role: context.stepId,
      },
    );

    return {
      ok: true,
      action: 'spawn_subagent_async',
      parent_container_id: parentContainerId,
      execution_id: executionId,
      workflow_run_id: context.workflowRunId,
    };
  }

  private omitSubagentListFields<
    T extends { assigned_files?: unknown; tools?: unknown },
  >(value: T): Omit<T, 'assigned_files' | 'tools'> {
    const rest = { ...value };
    Reflect.deleteProperty(rest, 'assigned_files');
    Reflect.deleteProperty(rest, 'tools');
    return rest;
  }

  async waitForSubagents(
    user: AgentUserContext | undefined,
    params: SubagentWaitBody,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveExecutionContext(user);
    const parentContainerId = await this.resolveParentContainerId(context);
    const executionIds = normalizeStringListInput(params.execution_ids);
    const timeoutSeconds = normalizeTimeoutSeconds(params.timeout_seconds);

    const result = await this.subagentOrchestrator.waitForSubagents(
      parentContainerId,
      {
        executionIds,
        timeoutSeconds,
      },
    );

    return {
      ok: true,
      action: 'wait_for_subagents',
      parent_container_id: parentContainerId,
      ...result,
    };
  }

  async checkSubagentStatus(
    user: AgentUserContext | undefined,
    executionId: string,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveExecutionContext(user);
    const parentContainerId = await this.resolveParentContainerId(context);

    const result = await this.subagentOrchestrator.checkStatus(
      parentContainerId,
      executionId,
      context.workflowRunId,
    );

    return {
      ok: true,
      action: 'check_subagent_status',
      parent_container_id: parentContainerId,
      ...result,
    };
  }

  private async resolveExecutionContext(
    user: AgentUserContext | undefined,
  ): Promise<AgentExecutionContext> {
    const parsed = this.executionContextResolver.parseAgentToken(user?.userId);
    if (!parsed) {
      throw new BadRequestException(
        'Agent execution context is required for subagent runtime tools',
      );
    }

    const run = await this.runRepository.findById(parsed.workflowRunId);
    if (!run) {
      throw new NotFoundException(
        `Workflow run ${parsed.workflowRunId} not found`,
      );
    }

    if (isTerminalWorkflowRunStatus(run.status)) {
      throw new ConflictException(
        `Workflow run ${parsed.workflowRunId} has terminal status ${run.status}`,
      );
    }

    return {
      ...parsed,
      jobId: user?.jobId?.trim() || parsed.jobId,
      stepId: user?.stepId?.trim() || undefined,
      lifecycleStage: this.stageSkillPolicy.resolveLifecycleStage(
        run.state_variables,
      ),
      stateVariables: run.state_variables ?? {},
    };
  }

  private async resolveParentContainerId(
    context: AgentExecutionContext,
  ): Promise<string> {
    const labels = [
      'nexus.managed=true',
      `nexus.workflow_run_id=${context.workflowRunId}`,
      `nexus.job_id=${context.jobId}`,
    ];

    let containers = await this.docker.listContainers({
      all: false,
      filters: {
        label: context.stepId
          ? [...labels, `nexus.step_id=${context.stepId}`]
          : labels,
        status: ['running'],
      },
    });

    if (containers.length === 0 && context.stepId) {
      containers = await this.docker.listContainers({
        all: false,
        filters: {
          label: labels,
          status: ['running'],
        },
      });
    }

    const sortedContainers = [...containers].sort(
      (a, b) => b.Created - a.Created,
    );
    const match = sortedContainers[0];
    if (!match?.Id) {
      throw new NotFoundException(
        `No running container found for run ${context.workflowRunId} and job ${context.jobId}`,
      );
    }

    return match.Id;
  }
}

/**
 * Resolves the final tool list for a subagent spawn by intersecting the
 * normalized tool candidates with the subagent profile's allowed set.
 * Companion rules (e.g. `spawn_subagent_async` → `wait_for_subagents`) are
 * applied so a granted primary tool always carries its companion.
 *
 * When no `agentProfile` is provided (anonymous spawns), all tools pass through
 * unchanged and `canProfileUseTool` is never called.
 */
function resolveProfileAllowedToolsForSubagent(
  tools: string[],
  agentProfile: string | undefined,
  toolMounting: Pick<ToolMountingService, 'canProfileUseTool'>,
): string[] {
  if (!agentProfile) {
    return tools;
  }

  const profileAllowed = new Set<string>(
    tools.filter((tool) => toolMounting.canProfileUseTool(agentProfile, tool)),
  );

  return resolveAllowedToolNamesForExecution({
    requestedTools: tools,
    profileAllowed,
    companionRules: DEFAULT_COMPANION_RULES,
  });
}

function normalizeStringListInput(
  value: string | string[] | undefined,
): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return normalizeStringEntries(value);
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return [];
  }

  const jsonParsed = parseJsonStringArray(trimmed);
  if (jsonParsed) {
    return jsonParsed;
  }

  return [trimmed];
}

function parseJsonStringArray(value: string): string[] | null {
  if (!value.startsWith('[') || !value.endsWith(']')) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }

    return normalizeStringEntries(
      parsed.filter((entry): entry is string => typeof entry === 'string'),
    );
  } catch {
    return null;
  }
}

function normalizeTimeoutSeconds(
  value: string | number | undefined,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed.length) {
    return undefined;
  }

  return Number(trimmed);
}

function normalizeStringEntries(value: string[]): string[] {
  const normalized = value
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(normalized)];
}
