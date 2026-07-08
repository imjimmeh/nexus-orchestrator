import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { IHostMountBinding, IJob } from '@nexus/core';
import { ChatSessionSource, ChatSessionStatus } from '@nexus/core';
import type { SubagentExecutionView } from './subagent-execution-view.types';
import type { WorkflowRun } from '../database/entities/workflow-run.entity';
import { buildSubagentContainerConfigOperation } from './subagent-orchestrator.container-config.operations';
import type {
  SubagentRuntimeSelection,
  SubagentSpawnOperationsContext,
} from './subagent-orchestrator.operations.types';
import { prepareSkillMountContext } from './subagent-orchestrator.spawn.skill-mount';
import type { SkillMountContext } from './subagent-orchestrator.spawn.skill-mount.types';
import { asRecord } from '@nexus/core';
import type {
  SubagentAsyncSpawnParams,
  SubagentSpawnParams,
} from './subagent-orchestrator.types';
import {
  ensureDepthWithinLimit,
  markSpawnFailed,
  persistSubagentRuntimeSelection,
  resolveNextSubagentDepth,
  upsertHostMountBinding,
} from './subagent-orchestrator.spawn.helpers';
import {
  ensureNoAssignedFileOverlap,
  extractScopeIdFromRunStateVariables,
  isTerminalSubagentStatus,
  normalizeStringList,
  resolveWorktreePathFromRun,
} from './subagent-orchestrator.utils';
import { scheduleSubagentExecutionKickoff } from './subagent-orchestrator.kickoff-execution.operations';

const DEFAULT_MAX_CONCURRENT_SUBAGENTS = 3;

export async function spawnSubagentAsyncOperation(
  context: SubagentSpawnOperationsContext,
  parentContainerId: string,
  params: SubagentAsyncSpawnParams,
): Promise<string> {
  const { execution, subagentChatSessionId } =
    await context.runParentContainerExclusive(parentContainerId, async () => {
      const activeExecutions = await resolveActiveExecutions(
        context,
        parentContainerId,
        params,
      );

      const profile = await validateAgentProfile(context, params.agent_profile);

      const assignedFiles = normalizeStringList(params.assigned_files);

      ensureNoAssignedFileOverlap(assignedFiles, activeExecutions);

      const currentDepth = await resolveNextSubagentDepth(
        context,
        parentContainerId,
      );
      ensureDepthWithinLimit(currentDepth);

      const execution = await createExecutionRecord(context, {
        parentContainerId,
        parentSessionTreeId: undefined,
        depth: currentDepth,
        assignedFiles,
        delegationContractId: params.delegation_contract_id,
        lineageTraceId: params.lineage_trace_id,
        lineageParentTraceId: params.lineage_parent_trace_id,
        role: params.role,
      });

      const parentSession =
        await context.chatSessionRepo.findByContainerId(parentContainerId);
      const subagentChatSessionId =
        await context.subagentChatSessionPort.createSubagentChatSession({
          profile,
          status: ChatSessionStatus.STARTING,
          executionState: 'starting',
          source: ChatSessionSource.SUBAGENT,
          initialMessage: params.task_prompt,
          displayName: buildSubagentDisplayName(params.task_prompt),
          overrides: {
            parent_chat_session_id: parentSession?.id ?? null,
            subagent_execution_id: execution.id,
            workflow_run_id: params.workflowRunId,
          },
        });

      await context.executionEvents.created(execution.id, {
        kind: 'subagent',
        workflow_run_id: params.workflowRunId,
        chat_session_id: subagentChatSessionId,
      });
      await context.executionEvents.provisioning(execution.id);

      await context.emitSubagentLifecycleEvent({
        eventName: 'spawn.requested',
        outcome: 'in_progress',
        workflowRunId: params.workflowRunId,
        parentContainerId,
        subagentExecutionId: execution.id,
        payload: {
          mode: 'async',
          agent_profile: params.agent_profile,
          task_prompt: params.task_prompt,
          subagent_chat_session_id: subagentChatSessionId,
          tier: params.tier,
          assigned_files: assignedFiles,
          inherit_host_mounts: params.inherit_host_mounts ?? true,
          requested_host_mount_count: Array.isArray(params.host_mounts)
            ? params.host_mounts.length
            : 0,
          status: 'spawning',
        },
      });

      return { execution, subagentChatSessionId };
    });

  spawnExecutionContainer(context, {
    execution,
    parentContainerId,
    params,
    mode: 'async',
    chatSessionId: subagentChatSessionId,
  }).catch((error: unknown) => {
    context.logger.error(
      `Background subagent container provisioning failed for execution ${execution.id}: ${context.resolveErrorMessage(error)}`,
    );
  });

  return execution.id;
}

async function resolveActiveExecutions(
  context: SubagentSpawnOperationsContext,
  parentContainerId: string,
  params: SubagentAsyncSpawnParams,
): Promise<SubagentExecutionView[]> {
  const maxConcurrent = await context.systemSettings.get(
    'max_concurrent_subagents_per_workflow',
    DEFAULT_MAX_CONCURRENT_SUBAGENTS,
  );
  const concurrentExecutions =
    await context.subagentReadModel.findByParentContainerId(parentContainerId);

  const activeExecutions = concurrentExecutions.filter(
    (execution) => !isTerminalSubagentStatus(execution.status),
  );

  if (params.role) {
    const duplicateForRole = activeExecutions.find(
      (e) => e.role === params.role,
    );
    if (duplicateForRole) {
      throw new BadRequestException({
        code: 'duplicate_subagent_for_step',
        message: `A non-terminal subagent (${duplicateForRole.id}) already exists for parent ${parentContainerId} role ${params.role}`,
      });
    }
  }

  if (activeExecutions.length >= maxConcurrent) {
    throw new BadRequestException({
      code: 'subagent_concurrency_limit_reached',
      message: `Maximum concurrent subagents (${maxConcurrent}) reached for this workflow.`,
      retryable: true,
      recommended_action: 'wait_for_subagents',
      active_subagent_ids: activeExecutions.map((e) => e.id),
    });
  }

  return activeExecutions;
}

async function fetchRunForSpawn(
  context: SubagentSpawnOperationsContext,
  workflowRunId: string,
): Promise<WorkflowRun | null> {
  try {
    return await context.runRepo.findById(workflowRunId);
  } catch (error) {
    context.logger.debug(
      `Failed to fetch run ${workflowRunId} for skill/scope context: ${context.resolveErrorMessage(error)}`,
    );
    return null;
  }
}

async function spawnExecutionContainer(
  context: SubagentSpawnOperationsContext,
  params: {
    execution: SubagentExecutionView;
    parentContainerId: string;
    params: SubagentSpawnParams;
    mode: 'sync' | 'async';
    chatSessionId?: string | null;
  },
): Promise<string> {
  const run = await fetchRunForSpawn(context, params.params.workflowRunId);
  const skillMount = await prepareSkillMountContext(context, params, run);

  try {
    const { childContainerId, runtime } = await provisionSubagentContainer(
      context,
      {
        execution: params.execution,
        parentContainerId: params.parentContainerId,
        params: params.params,
        skillMount,
        chatSessionId: params.chatSessionId,
        run,
      },
    );

    await persistSubagentRuntimeSelection(context, {
      chatSessionId: params.chatSessionId,
      runtime,
    });

    await context.emitSubagentLifecycleEvent({
      eventName: 'spawn.succeeded',
      outcome: 'success',
      workflowRunId: params.params.workflowRunId,
      parentContainerId: params.parentContainerId,
      subagentExecutionId: params.execution.id,
      payload: {
        child_container_id: childContainerId,
        subagent_chat_session_id: params.chatSessionId,
        harness_id: runtime.harnessId,
        provider: runtime.provider,
        model: runtime.model,
        status: 'running',
      },
    });

    scheduleSubagentExecutionKickoff(context, {
      executionId: params.execution.id,
      workflowRunId: params.params.workflowRunId,
      parentContainerId: params.parentContainerId,
      childContainerId,
      skillMountKey: skillMount.skillMountKey,
      subagentChatSessionId: params.chatSessionId,
      resumeSessionTreeId: params.params.resumeSessionTreeId,
    });

    return childContainerId;
  } catch (error) {
    context.skillMounting.cleanupSkillMount(skillMount.skillMountKey);
    await markSpawnFailed(context, {
      executionId: params.execution.id,
      workflowRunId: params.params.workflowRunId,
      parentContainerId: params.parentContainerId,
      error,
    });

    throw error;
  }
}

async function provisionSubagentContainer(
  context: SubagentSpawnOperationsContext,
  params: {
    execution: SubagentExecutionView;
    parentContainerId: string;
    params: SubagentSpawnParams;
    skillMount: SkillMountContext;
    chatSessionId?: string | null;
    run: WorkflowRun | null;
  },
): Promise<{ childContainerId: string; runtime: SubagentRuntimeSelection }> {
  const run = params.run;
  const hostMountBindings = await resolveSubagentHostMountBindings(context, {
    executionId: params.execution.id,
    parentContainerId: params.parentContainerId,
    spawnParams: params.params,
    stateVariables: asRecord(run?.state_variables),
  });

  const scopeId = run
    ? extractScopeIdFromRunStateVariables(run.state_variables)
    : undefined;
  const executionContext: { ownerType: 'scope'; ownerId: string } | undefined =
    scopeId ? { ownerType: 'scope', ownerId: scopeId } : undefined;

  const worktreePath = await resolveWorkspaceMountPath(context, run);

  const { config, runtime } = await buildSubagentContainerConfigOperation(
    context,
    {
      executionId: params.execution.id,
      parentContainerId: params.parentContainerId,
      spawnParams: params.params,
      hostMountBindings,
      skillMountPath: params.skillMount.skillMountPath,
      assignedSkills: params.skillMount.assignedSkills,
      chatSessionId: params.chatSessionId,
      scopeNodeId: scopeId,
      executionContext,
      workflowId: run?.workflow_id ?? undefined,
      workspacePath: worktreePath,
    },
  );

  const childContainerId =
    await context.containerOrchestrator.provisionContainer(
      config,
      true,
      true,
      worktreePath,
    );

  await context.executionEvents.provisioned(
    params.execution.id,
    childContainerId,
  );
  await context.executionEvents.running(params.execution.id);

  return { childContainerId, runtime };
}

async function resolveSubagentHostMountBindings(
  context: SubagentSpawnOperationsContext,
  params: {
    executionId: string;
    parentContainerId: string;
    spawnParams: SubagentSpawnParams;
    stateVariables?: Record<string, unknown>;
  },
): Promise<IHostMountBinding[]> {
  const merged = new Map<string, IHostMountBinding>();

  if (params.spawnParams.inherit_host_mounts !== false) {
    const inheritedBindings =
      await context.containerOrchestrator.getContainerHostMountBindings(
        params.parentContainerId,
      );

    for (const binding of inheritedBindings) {
      upsertHostMountBinding(merged, binding);
    }
  }

  if (
    Array.isArray(params.spawnParams.host_mounts) &&
    params.spawnParams.host_mounts.length > 0
  ) {
    const hostMountJob: IJob = {
      id: `subagent-host-mounts:${params.executionId}`,
      type: 'execution',
      tier: params.spawnParams.tier ?? 'heavy',
      steps: [],
      host_mounts: params.spawnParams.host_mounts,
    };

    const resolvedBindings =
      await context.hostMountResolution.resolveHostMountBindings({
        job: hostMountJob,
        agentProfile: params.spawnParams.agent_profile,
        stateVariables: params.stateVariables,
      });

    for (const binding of resolvedBindings) {
      upsertHostMountBinding(merged, binding);
    }
  }

  return [...merged.values()];
}

async function resolveWorkspaceMountPath(
  context: SubagentSpawnOperationsContext,
  run: WorkflowRun | null,
): Promise<string | undefined> {
  const worktreePath = resolveWorktreePathFromRun(run);
  if (worktreePath) {
    return worktreePath;
  }

  const scopeId = run
    ? extractScopeIdFromRunStateVariables(run.state_variables)
    : undefined;
  if (!scopeId) {
    return undefined;
  }

  try {
    return await context.gitWorktreeService.resolveProjectBasePath(scopeId);
  } catch {
    throw new Error(
      `Unable to resolve workspace mount path for workflow scope '${scopeId}'`,
    );
  }
}

async function validateAgentProfile(
  context: SubagentSpawnOperationsContext,
  profileName: string,
): Promise<{ id: string; name: string }> {
  const profile = await context.agentProfileRepo.findByName(profileName);
  if (profile) {
    return profile;
  }
  const allProfiles = await context.agentProfileRepo.findAll();
  const activeProfileNames = allProfiles
    .filter((candidate) => candidate.is_active)
    .map((candidate) => candidate.name)
    .sort((a, b) => a.localeCompare(b));
  const suggestion =
    activeProfileNames.length > 0
      ? ` Available active profiles: ${activeProfileNames.join(', ')}.`
      : ' No active agent profiles are currently registered.';
  throw new BadRequestException(
    `Agent profile '${profileName}' not found or inactive.${suggestion}`,
  );
}

function buildSubagentDisplayName(taskPrompt: string): string {
  return `Subagent: ${
    taskPrompt.length > 40 ? `${taskPrompt.slice(0, 40)}...` : taskPrompt
  }`;
}

async function createExecutionRecord(
  context: SubagentSpawnOperationsContext,
  params: {
    parentContainerId: string;
    parentSessionTreeId?: string;
    depth: number;
    assignedFiles?: string[];
    delegationContractId?: string;
    lineageTraceId?: string;
    lineageParentTraceId?: string | null;
    role?: string;
  },
): Promise<SubagentExecutionView> {
  const id = randomUUID();

  // DB columns require explicit null for absent values; the view uses undefined (SubagentExecutionView field shape).
  await context.subagentDetailsRepo.upsert({
    execution_id: id,
    parent_container_id: params.parentContainerId,
    parent_session_tree_id: params.parentSessionTreeId ?? null,
    depth: params.depth,
    assigned_files: params.assignedFiles ?? null,
    delegation_contract_id: params.delegationContractId ?? null,
    lineage_trace_id: params.lineageTraceId ?? null,
    lineage_parent_trace_id: params.lineageParentTraceId ?? null,
    role: params.role ?? null,
    is_active: true,
  });

  return {
    id,
    status: 'Spawning',
    parent_container_id: params.parentContainerId,
    parent_session_tree_id: params.parentSessionTreeId,
    depth: params.depth,
    assigned_files: params.assignedFiles,
    delegation_contract_id: params.delegationContractId,
    lineage_trace_id: params.lineageTraceId,
    lineage_parent_trace_id: params.lineageParentTraceId ?? undefined,
    role: params.role,
    created_at: new Date(),
  };
}
