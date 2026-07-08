import { Injectable } from '@nestjs/common';
import type { DelegationContract } from '../database/entities/delegation-contract.entity';
import { DelegationContractRepository } from '../database/repositories/delegation-contract.repository';
import type {
  MeshDelegationDispatchParams,
  MeshDelegationDispatchResult,
  MeshDelegationSweepParams,
  MeshDelegationSweepResult,
} from './mesh-delegation.service.types';
import { MeshDelegationAuditPublisherService } from './mesh-delegation-audit-publisher.service';
import { MeshDelegationCandidateQueryService } from './mesh-delegation-candidate-query.service';
import { MeshDelegationCapacityPolicyService } from './mesh-delegation-capacity-policy.service';
import { MeshDelegationDispatchExecutorService } from './mesh-delegation-dispatch-executor.service';
import { MeshDelegationStatusUpdaterService } from './mesh-delegation-status-updater.service';

@Injectable()
export class MeshDelegationDispatchService {
  constructor(
    private readonly delegationRepo: DelegationContractRepository,
    private readonly candidateQuery: MeshDelegationCandidateQueryService,
    private readonly capacityPolicy: MeshDelegationCapacityPolicyService,
    private readonly statusUpdater: MeshDelegationStatusUpdaterService,
    private readonly dispatchExecutor: MeshDelegationDispatchExecutorService,
    private readonly auditPublisher: MeshDelegationAuditPublisherService,
  ) {}

  async ensureQueueDepthWithinLimit(
    workflowRunId: string,
    parentContainerId: string,
  ): Promise<void> {
    return this.capacityPolicy.ensureQueueDepthWithinLimit(
      workflowRunId,
      parentContainerId,
    );
  }

  async resolveLineage(params: {
    parentDelegationId: string | null;
    parentTraceId: string | null;
  }): Promise<{
    traceId: string;
    parentTraceId: string | null;
    lineageDepth: number;
    lineagePath: string[];
  }> {
    return this.candidateQuery.resolveLineage(params);
  }

  async dispatchQueuedDelegations(
    params: MeshDelegationDispatchParams,
  ): Promise<MeshDelegationDispatchResult> {
    const { availableSlots } = await this.capacityPolicy.resolveAvailableSlots({
      workflowRunId: params.workflowRunId,
      parentContainerId: params.parentContainerId,
    });

    if (availableSlots === 0) {
      return this.buildDispatchResult({
        workflowRunId: params.workflowRunId,
        parentContainerId: params.parentContainerId,
        dispatchedContractIds: [],
        failedContractIds: [],
        backpressure: true,
      });
    }

    const queuedContracts = await this.candidateQuery.findQueuedContracts({
      workflowRunId: params.workflowRunId,
      parentContainerId: params.parentContainerId,
      limit: availableSlots,
    });

    const dispatchedContractIds: string[] = [];
    const failedContractIds: string[] = [];

    for (const contract of queuedContracts) {
      const dispatched = await this.dispatchExecutor.dispatchContract(
        contract,
        params,
      );
      if (dispatched) {
        dispatchedContractIds.push(contract.id);
      } else {
        failedContractIds.push(contract.id);
      }
    }

    return this.buildDispatchResult({
      workflowRunId: params.workflowRunId,
      parentContainerId: params.parentContainerId,
      dispatchedContractIds,
      failedContractIds,
      backpressure: false,
    });
  }

  async sweepTimedOutDelegations(
    params: MeshDelegationSweepParams,
  ): Promise<MeshDelegationSweepResult> {
    const contracts = await this.candidateQuery.findExpiredContracts(
      params.workflowRunId,
    );

    const timedOutContractIds: string[] = [];
    const requeuedContractIds: string[] = [];
    const failedToCancelContractIds: string[] = [];

    for (const contract of contracts) {
      const cancelled = await this.cancelRunningExecutionIfNeeded(
        contract,
        params.cancelHandler,
      );
      if (!cancelled) {
        failedToCancelContractIds.push(contract.id);
        continue;
      }

      if (contract.attempt_count <= contract.max_retries) {
        await this.statusUpdater.requeueTimedOutContract(contract.id);
        requeuedContractIds.push(contract.id);
        continue;
      }

      await this.statusUpdater.markTimedOutContract(contract.id);
      timedOutContractIds.push(contract.id);
    }

    return {
      timedOutContractIds,
      requeuedContractIds,
      failedToCancelContractIds,
    };
  }

  private async cancelRunningExecutionIfNeeded(
    contract: DelegationContract,
    cancelHandler?: MeshDelegationSweepParams['cancelHandler'],
  ): Promise<boolean> {
    if (
      contract.status !== 'running' ||
      !contract.subagent_execution_id ||
      !cancelHandler
    ) {
      return contract.status !== 'running';
    }

    return cancelHandler({
      workflowRunId: contract.workflow_run_id,
      parentContainerId: contract.parent_container_id,
      subagentExecutionId: contract.subagent_execution_id,
      reason: 'mesh_timeout',
    });
  }

  private async buildDispatchResult(params: {
    workflowRunId: string;
    parentContainerId: string;
    dispatchedContractIds: string[];
    failedContractIds: string[];
    backpressure: boolean;
  }): Promise<MeshDelegationDispatchResult> {
    const queuedCount = await this.capacityPolicy.countQueuedContracts(
      params.workflowRunId,
      params.parentContainerId,
    );
    const runningCount = await this.capacityPolicy.countRunningContracts(
      params.workflowRunId,
      params.parentContainerId,
    );

    const maxConcurrent =
      await this.capacityPolicy.resolveMaxConcurrentDelegations();
    const hasRunningOverflow = runningCount > maxConcurrent;
    if (hasRunningOverflow && params.backpressure) {
      await this.auditPublisher.appendLifecycleEvent({
        workflowRunId: params.workflowRunId,
        eventType: 'mesh_delegation.dispatch_backpressure',
        payload: {
          parent_container_id: params.parentContainerId,
          running_count: runningCount,
          max_concurrent: maxConcurrent,
        },
      });
    }

    return {
      workflowRunId: params.workflowRunId,
      parentContainerId: params.parentContainerId,
      dispatchedContractIds: params.dispatchedContractIds,
      failedContractIds: params.failedContractIds,
      queuedCount,
      runningCount,
      backpressure: params.backpressure,
    };
  }
}
