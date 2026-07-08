import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { DelegationContract } from '../database/entities/delegation-contract.entity';
import { DelegationContractRepository } from '../database/repositories/delegation-contract.repository';
import { AuditLogService } from '../../audit/audit-log.service';
import { WorkflowEventLogService } from '../workflow-event-log.service';
import { MeshDelegationDispatchService } from './mesh-delegation-dispatch.service';
import { MeshDelegationGovernanceService } from './mesh-delegation-governance.service';
import type { MeshDelegationGovernanceDecision } from './mesh-delegation-governance.service.types';
import type {
  MeshDelegationCancelParams,
  MeshDelegationCancelResult,
  MeshDelegationCancellationParams,
  MeshDelegationCompletionParams,
  MeshDelegationCreateParams,
  MeshDelegationCreateResult,
  MeshDelegationDispatchParams,
  MeshDelegationDispatchResult,
  MeshDelegationReplayResult,
  MeshDelegationSweepParams,
  MeshDelegationSweepResult,
} from './mesh-delegation.service.types';
import {
  MESH_DELEGATION_EVENT_PREFIX,
  isTerminalContractStatus,
  normalizeAssignedFiles,
  resolveResultErrorMessage,
  resolveTerminalStatusFromResult,
} from './mesh-delegation.service.utils';

@Injectable()
export class MeshDelegationService {
  constructor(
    private readonly delegationRepo: DelegationContractRepository,
    private readonly governance: MeshDelegationGovernanceService,
    private readonly workflowEventLog: WorkflowEventLogService,
    private readonly auditLog: AuditLogService,
    private readonly dispatchService: MeshDelegationDispatchService,
  ) {}

  async createDelegation(
    params: MeshDelegationCreateParams,
    dispatchParams?: MeshDelegationDispatchParams,
  ): Promise<MeshDelegationCreateResult> {
    const governanceDecision = await this.evaluateGovernance(params);

    if (governanceDecision.allowed) {
      await this.dispatchService.ensureQueueDepthWithinLimit(
        params.workflowRunId,
        params.parentContainerId,
      );
    }

    const lineage = await this.dispatchService.resolveLineage({
      parentDelegationId: params.parentDelegationId,
      parentTraceId: params.parentTraceId,
    });

    const contract = await this.persistDelegationContract({
      params,
      governanceDecision,
      lineage,
    });

    await this.recordCreationLifecycle(contract, governanceDecision);

    const dispatchResult =
      governanceDecision.allowed && dispatchParams
        ? await this.dispatchService.dispatchQueuedDelegations(dispatchParams)
        : null;

    return {
      contract,
      governanceDecision,
      dispatchResult,
    };
  }

  async dispatchQueuedDelegations(
    params: MeshDelegationDispatchParams,
  ): Promise<MeshDelegationDispatchResult> {
    return this.dispatchService.dispatchQueuedDelegations(params);
  }

  async sweepTimedOutDelegations(
    params: MeshDelegationSweepParams,
  ): Promise<MeshDelegationSweepResult> {
    return this.dispatchService.sweepTimedOutDelegations(params);
  }

  async handleSubagentCompletion(
    params: MeshDelegationCompletionParams,
  ): Promise<DelegationContract | null> {
    const contract = await this.delegationRepo.findBySubagentExecutionId(
      params.subagentExecutionId,
    );
    if (!contract) {
      return null;
    }

    const resolvedStatus = resolveTerminalStatusFromResult(params.result);
    const updatedContract = await this.delegationRepo.update(contract.id, {
      status: resolvedStatus,
      completed_at: new Date(),
      last_error:
        resolvedStatus === 'failed'
          ? resolveResultErrorMessage(params.result)
          : null,
    });

    await this.appendLifecycleEvent({
      workflowRunId: contract.workflow_run_id,
      eventType: `${MESH_DELEGATION_EVENT_PREFIX}.${resolvedStatus}`,
      actorId: contract.requester_agent_profile ?? undefined,
      payload: {
        contract_id: contract.id,
        subagent_execution_id: contract.subagent_execution_id,
        trace_id: contract.trace_id,
      },
    });

    await this.writeAudit({
      contract,
      action: 'complete',
      result: resolvedStatus === 'completed' ? 'success' : 'failure',
      metadata: {
        resolved_status: resolvedStatus,
      },
    });

    return updatedContract;
  }

  async handleSubagentCancellation(
    params: MeshDelegationCancellationParams,
  ): Promise<DelegationContract | null> {
    const contract = await this.delegationRepo.findBySubagentExecutionId(
      params.subagentExecutionId,
    );
    if (!contract) {
      return null;
    }

    const updatedContract = await this.delegationRepo.update(contract.id, {
      status: 'cancelled',
      completed_at: new Date(),
      last_error: params.reason,
    });

    await this.appendLifecycleEvent({
      workflowRunId: contract.workflow_run_id,
      eventType: `${MESH_DELEGATION_EVENT_PREFIX}.cancelled`,
      actorId: contract.requester_agent_profile ?? undefined,
      payload: {
        contract_id: contract.id,
        subagent_execution_id: contract.subagent_execution_id,
        reason: params.reason,
      },
    });

    await this.writeAudit({
      contract,
      action: 'cancel',
      result: 'success',
      metadata: { reason: params.reason },
    });

    return updatedContract;
  }

  async cancelDelegation(
    params: MeshDelegationCancelParams,
  ): Promise<MeshDelegationCancelResult> {
    const contract = await this.requireContractForWorkflow(
      params.contractId,
      params.workflowRunId,
    );

    if (isTerminalContractStatus(contract.status)) {
      return { contract, cancelled: false };
    }

    await this.cancelRunningContractIfRequired(contract, params);

    const updatedContract = await this.delegationRepo.update(contract.id, {
      status: 'cancelled',
      completed_at: new Date(),
      last_error: params.reason,
    });

    if (!updatedContract) {
      throw new NotFoundException(
        `Delegation contract ${params.contractId} no longer exists`,
      );
    }

    await this.appendLifecycleEvent({
      workflowRunId: contract.workflow_run_id,
      eventType: `${MESH_DELEGATION_EVENT_PREFIX}.cancelled`,
      actorId: contract.requester_agent_profile ?? undefined,
      payload: {
        contract_id: contract.id,
        reason: params.reason,
      },
    });

    await this.writeAudit({
      contract,
      action: 'cancel',
      result: 'success',
      metadata: { reason: params.reason },
    });

    return {
      contract: updatedContract,
      cancelled: true,
    };
  }

  async getContractById(
    contractId: string,
  ): Promise<DelegationContract | null> {
    return this.delegationRepo.findById(contractId);
  }

  async getReplay(
    workflowRunId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<MeshDelegationReplayResult> {
    const [contracts] = await this.delegationRepo.findByWorkflowRunId(
      workflowRunId,
      options.limit ?? 100,
      options.offset ?? 0,
    );

    const history = await this.workflowEventLog.getHistory(
      workflowRunId,
      500,
      0,
    );
    const lifecycleEvents = history.events
      .filter((event) =>
        event.event_type.startsWith(`${MESH_DELEGATION_EVENT_PREFIX}.`),
      )
      .map((event) => ({
        id: event.id,
        eventType: event.event_type,
        timestamp: event.timestamp,
        actorId: event.actor_id,
        payload: event.payload,
      }));

    return {
      workflowRunId,
      contracts,
      lifecycleEvents,
    };
  }

  private async evaluateGovernance(
    params: MeshDelegationCreateParams,
  ): Promise<MeshDelegationGovernanceDecision> {
    return this.governance.evaluate({
      targetAgentProfile: params.targetAgentProfile,
      requestedTools: params.requestedTools,
      allowedTools: params.allowedTools,
      deniedTools: params.deniedTools,
      tokenBudget: params.tokenBudget,
      timeBudgetMs: params.timeBudgetMs,
      maxRetries: params.maxRetries,
      queuePriority: params.queuePriority,
      allowPrivilegedTools: params.allowPrivilegedTools,
    });
  }

  private async persistDelegationContract(params: {
    params: MeshDelegationCreateParams;
    governanceDecision: MeshDelegationGovernanceDecision;
    lineage: {
      traceId: string;
      parentTraceId: string | null;
      lineageDepth: number;
      lineagePath: string[];
    };
  }): Promise<DelegationContract> {
    return this.delegationRepo.create({
      workflow_run_id: params.params.workflowRunId,
      parent_container_id: params.params.parentContainerId,
      parent_execution_id: params.params.parentExecutionId,
      requester_agent_profile: params.params.requesterAgentProfile,
      target_agent_profile: params.params.targetAgentProfile,
      objective: params.params.objective,
      task_prompt: params.params.taskPrompt,
      success_criteria: params.params.successCriteria,
      requested_tools: params.params.requestedTools,
      effective_tools: params.governanceDecision.effectiveTools,
      allowed_tools: params.params.allowedTools,
      denied_tools: params.params.deniedTools,
      assigned_files: normalizeAssignedFiles(params.params.assignedFiles),
      target_tier: params.params.targetTier,
      token_budget: params.params.tokenBudget,
      time_budget_ms: params.params.timeBudgetMs,
      max_retries: params.params.maxRetries,
      queue_priority: params.params.queuePriority,
      escalation_path: params.params.escalationPath,
      expected_artifacts: params.params.expectedArtifacts,
      metadata: params.params.metadata,
      parent_delegation_id: params.params.parentDelegationId,
      trace_id: params.lineage.traceId,
      parent_trace_id: params.lineage.parentTraceId,
      lineage_depth: params.lineage.lineageDepth,
      lineage_path: params.lineage.lineagePath,
      governance_decision: {
        allowed: params.governanceDecision.allowed,
        denial_reason: params.governanceDecision.denialReason ?? null,
        rationale: params.governanceDecision.rationale,
        privileged_tools: params.governanceDecision.privilegedTools,
      },
      status: params.governanceDecision.allowed ? 'queued' : 'denied',
    });
  }

  private async recordCreationLifecycle(
    contract: DelegationContract,
    governanceDecision: MeshDelegationGovernanceDecision,
  ): Promise<void> {
    await this.appendLifecycleEvent({
      workflowRunId: contract.workflow_run_id,
      eventType: governanceDecision.allowed
        ? `${MESH_DELEGATION_EVENT_PREFIX}.queued`
        : `${MESH_DELEGATION_EVENT_PREFIX}.denied`,
      actorId: contract.requester_agent_profile ?? undefined,
      payload: {
        contract_id: contract.id,
        trace_id: contract.trace_id,
        target_agent_profile: contract.target_agent_profile,
        queue_priority: contract.queue_priority,
        denial_reason: governanceDecision.denialReason,
      },
    });

    await this.writeAudit({
      contract,
      action: 'create',
      result: governanceDecision.allowed ? 'success' : 'denied',
      metadata: {
        denial_reason: governanceDecision.denialReason,
        rationale: governanceDecision.rationale,
      },
    });
  }

  private async requireContractForWorkflow(
    contractId: string,
    workflowRunId: string,
  ): Promise<DelegationContract> {
    const contract = await this.delegationRepo.findById(contractId);
    if (!contract) {
      throw new NotFoundException(
        `Delegation contract ${contractId} not found`,
      );
    }

    if (contract.workflow_run_id !== workflowRunId) {
      throw new BadRequestException(
        `Delegation contract ${contractId} does not belong to workflow run ${workflowRunId}`,
      );
    }

    return contract;
  }

  private async cancelRunningContractIfRequired(
    contract: DelegationContract,
    params: MeshDelegationCancelParams,
  ): Promise<void> {
    if (contract.status !== 'running') {
      return;
    }

    if (!contract.subagent_execution_id) {
      return;
    }

    if (!params.cancelHandler) {
      throw new BadRequestException(
        'cancelHandler is required to cancel running delegation contracts',
      );
    }

    const cancelled = await params.cancelHandler({
      workflowRunId: contract.workflow_run_id,
      parentContainerId: contract.parent_container_id,
      subagentExecutionId: contract.subagent_execution_id,
      reason: params.reason,
    });

    if (!cancelled) {
      throw new BadRequestException(
        `Failed to cancel running delegation contract ${contract.id}`,
      );
    }
  }

  private async appendLifecycleEvent(params: {
    workflowRunId: string;
    eventType: string;
    actorId?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    await this.workflowEventLog.appendBestEffort({
      workflowRunId: params.workflowRunId,
      eventType: params.eventType,
      actorId: params.actorId,
      payload: params.payload,
    });
  }

  private async writeAudit(params: {
    contract: DelegationContract;
    action: string;
    result: 'success' | 'failure' | 'denied';
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.auditLog.log(
      'MeshDelegationContract',
      params.contract.requester_agent_profile ?? 'system',
      params.action,
      params.result,
      params.contract.id,
      {
        workflow_run_id: params.contract.workflow_run_id,
        trace_id: params.contract.trace_id,
        ...params.metadata,
      },
    );
  }
}
