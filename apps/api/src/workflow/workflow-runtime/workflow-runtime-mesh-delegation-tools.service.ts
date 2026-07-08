import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isTerminalWorkflowRunStatus } from '@nexus/core';
import Docker from 'dockerode';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { MeshDelegationService } from '../workflow-subagents/mesh-delegation.service';
import { SubagentOrchestratorService } from '../workflow-subagents/subagent-orchestrator.service';
import { mergeSdkNativeToolsForSubagent } from '../workflow-subagents/subagent-tool-merge.helpers';
import { WorkflowStageSkillPolicyService } from '../workflow-stage-skill-policy.service';
import { ExecutionContextResolverService } from '../execution-context-resolver.service';
import type {
  MeshDelegationCancelRequest,
  MeshDelegationDispatchParams,
  MeshDelegationSpawnRequest,
} from '../workflow-subagents/mesh-delegation.service.types';
import type { WorkflowLifecycleStage } from '../workflow-stage-skill-policy.service.types';

interface AgentUserContext {
  userId?: string;
  agentProfileName?: string;
  stepId?: string;
  jobId?: string;
}

interface AgentExecutionContext {
  workflowRunId: string;
  jobId: string;
  stepId?: string;
  lifecycleStage: WorkflowLifecycleStage | null;
  requesterAgentProfile: string | null;
}

interface DelegationContractCreateInput {
  objective: string;
  task_prompt?: string;
  success_criteria?: string[];
  agent_profile: string;
  tools: string[];
  tier: 'light' | 'heavy';
  assigned_files?: string[];
  allowed_tools?: string[];
  denied_tools?: string[];
  token_budget?: number;
  time_budget_ms?: number;
  max_retries?: number;
  queue_priority?: number;
  escalation_path?: string[];
  expected_artifacts?: string[];
  metadata?: Record<string, unknown>;
  parent_delegation_id?: string;
  parent_trace_id?: string;
  allow_privileged_tools?: boolean;
}

type DelegationContractIdentityInput = { contract_id: string };

interface DelegationContractCancelInput extends DelegationContractIdentityInput {
  reason?: string;
}

type DelegationReplayInput = { limit?: number; offset?: number };

@Injectable()
export class WorkflowRuntimeMeshDelegationToolsService {
  constructor(
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepository: IWorkflowRunRepository,
    private readonly subagentOrchestrator: SubagentOrchestratorService,
    private readonly meshDelegation: MeshDelegationService,
    private readonly stageSkillPolicy: WorkflowStageSkillPolicyService,
    private readonly executionContextResolver: ExecutionContextResolverService,
    @Inject(DOCKER_CLIENT) private readonly docker: Docker,
  ) {}

  async createDelegationContract(
    user: AgentUserContext | undefined,
    params: DelegationContractCreateInput,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveExecutionContext(user);
    const parentContainerId = await this.resolveParentContainerId(context);
    const normalizedObjective = requireNonEmptyText(
      params.objective,
      'objective',
    );

    const createResult = await this.meshDelegation.createDelegation(
      {
        workflowRunId: context.workflowRunId,
        parentContainerId,
        parentExecutionId: context.jobId,
        requesterAgentProfile: context.requesterAgentProfile,
        objective: normalizedObjective,
        taskPrompt:
          normalizeOptionalText(params.task_prompt) ?? normalizedObjective,
        successCriteria: normalizeStringList(params.success_criteria),
        targetAgentProfile: requireNonEmptyText(
          params.agent_profile,
          'agent_profile',
        ),
        requestedTools: normalizeStringList(params.tools),
        targetTier: params.tier,
        assignedFiles: normalizeStringList(params.assigned_files),
        allowedTools: normalizeStringList(params.allowed_tools),
        deniedTools: normalizeStringList(params.denied_tools),
        tokenBudget: normalizeOptionalInteger(params.token_budget),
        timeBudgetMs: normalizeOptionalInteger(params.time_budget_ms),
        maxRetries: normalizeNonNegativeInteger(params.max_retries, 0),
        queuePriority: normalizePositiveInteger(params.queue_priority, 100),
        escalationPath: normalizeStringList(params.escalation_path),
        expectedArtifacts: normalizeStringList(params.expected_artifacts),
        metadata: params.metadata ?? null,
        parentDelegationId: normalizeOptionalText(params.parent_delegation_id),
        parentTraceId: normalizeOptionalText(params.parent_trace_id),
        allowPrivilegedTools: params.allow_privileged_tools === true,
        lifecycleStage: context.lifecycleStage,
      },
      this.createMeshDispatchParams(context, parentContainerId),
    );

    return {
      ok: true,
      action: 'create_delegation_contract',
      workflow_run_id: context.workflowRunId,
      parent_container_id: parentContainerId,
      contract: createResult.contract,
      governance: createResult.governanceDecision,
      dispatch: createResult.dispatchResult,
    };
  }

  async getDelegationContract(
    user: AgentUserContext | undefined,
    params: DelegationContractIdentityInput,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveExecutionContext(user);
    const contractId = requireNonEmptyText(params.contract_id, 'contract_id');
    const contract = await this.meshDelegation.getContractById(contractId);

    if (!contract) {
      throw new NotFoundException(
        `Delegation contract ${contractId} not found`,
      );
    }

    if (contract.workflow_run_id !== context.workflowRunId) {
      throw new BadRequestException(
        `Delegation contract ${contractId} does not belong to workflow run ${context.workflowRunId}`,
      );
    }

    return {
      ok: true,
      action: 'get_delegation_contract',
      contract,
    };
  }

  async cancelDelegationContract(
    user: AgentUserContext | undefined,
    params: DelegationContractCancelInput,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveExecutionContext(user);
    const cancelResult = await this.meshDelegation.cancelDelegation({
      workflowRunId: context.workflowRunId,
      contractId: requireNonEmptyText(params.contract_id, 'contract_id'),
      reason: normalizeOptionalText(params.reason) ?? 'manual_cancel',
      cancelHandler: (request) => this.cancelMeshSubagentExecution(request),
    });

    return {
      ok: true,
      action: 'cancel_delegation_contract',
      cancelled: cancelResult.cancelled,
      contract: cancelResult.contract,
    };
  }

  async dispatchDelegationContracts(
    user: AgentUserContext | undefined,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveExecutionContext(user);
    const parentContainerId = await this.resolveParentContainerId(context);
    const result = await this.meshDelegation.dispatchQueuedDelegations(
      this.createMeshDispatchParams(context, parentContainerId),
    );

    return {
      ok: true,
      action: 'dispatch_delegation_contracts',
      ...result,
    };
  }

  async getDelegationReplay(
    user: AgentUserContext | undefined,
    params: DelegationReplayInput,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveExecutionContext(user);
    const replay = await this.meshDelegation.getReplay(context.workflowRunId, {
      limit: normalizePositiveInteger(params.limit, 100),
      offset: normalizeNonNegativeInteger(params.offset, 0),
    });

    return {
      ok: true,
      action: 'get_delegation_replay',
      ...replay,
    };
  }

  async sweepDelegationTimeouts(
    user: AgentUserContext | undefined,
  ): Promise<Record<string, unknown>> {
    const context = await this.resolveExecutionContext(user);
    const result = await this.meshDelegation.sweepTimedOutDelegations({
      workflowRunId: context.workflowRunId,
      cancelHandler: (request) => this.cancelMeshSubagentExecution(request),
    });

    return {
      ok: true,
      action: 'sweep_delegation_timeouts',
      workflow_run_id: context.workflowRunId,
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
      requesterAgentProfile: normalizeOptionalText(user?.agentProfileName),
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

  private createMeshDispatchParams(
    context: AgentExecutionContext,
    parentContainerId: string,
  ): MeshDelegationDispatchParams {
    return {
      workflowRunId: context.workflowRunId,
      parentContainerId,
      lifecycleStage: context.lifecycleStage,
      spawnHandler: (request) => this.spawnMeshDelegationRequest(request),
    };
  }

  private spawnMeshDelegationRequest(
    request: MeshDelegationSpawnRequest,
  ): Promise<string> {
    return this.subagentOrchestrator.spawn(request.parentContainerId, {
      agent_profile: request.agentProfile,
      task_prompt: request.taskPrompt,
      tools: mergeSdkNativeToolsForSubagent(request.tools),
      tier: request.tier,
      workflowRunId: request.workflowRunId,
      lifecycle_stage: request.lifecycleStage,
      assigned_files: request.assignedFiles,
      delegation_contract_id: request.contractId,
      lineage_trace_id: request.traceId,
      lineage_parent_trace_id: request.parentTraceId,
    });
  }

  private cancelMeshSubagentExecution(
    request: MeshDelegationCancelRequest,
  ): Promise<boolean> {
    return this.subagentOrchestrator.cancelExecution(
      request.parentContainerId,
      request.subagentExecutionId,
      {
        workflowRunId: request.workflowRunId,
        reason: request.reason,
      },
    );
  }
}

function normalizeStringList(value: string[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(normalized)];
}

function requireNonEmptyText(value: string, field: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new BadRequestException(`${field} is required`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeOptionalInteger(value: number | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  if (!Number.isInteger(value)) {
    return null;
  }

  return value;
}

function normalizePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  const normalized = normalizeOptionalInteger(value);
  if (normalized === null) {
    return fallback;
  }

  return normalized > 0 ? normalized : fallback;
}

function normalizeNonNegativeInteger(
  value: number | undefined,
  fallback: number,
): number {
  const normalized = normalizeOptionalInteger(value);
  if (normalized === null) {
    return fallback;
  }

  return normalized >= 0 ? normalized : fallback;
}
