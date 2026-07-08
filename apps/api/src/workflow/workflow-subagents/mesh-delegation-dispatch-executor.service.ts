import { Injectable } from '@nestjs/common';
import type { DelegationContract } from '../database/entities/delegation-contract.entity';
import type { MeshDelegationDispatchParams } from './mesh-delegation.service.types';
import {
  MESH_DELEGATION_EVENT_PREFIX,
  resolveErrorMessage,
  toSpawnRequest,
} from './mesh-delegation.service.utils';
import { MeshDelegationAuditPublisherService } from './mesh-delegation-audit-publisher.service';
import { MeshDelegationStatusUpdaterService } from './mesh-delegation-status-updater.service';

@Injectable()
export class MeshDelegationDispatchExecutorService {
  constructor(
    private readonly statusUpdater: MeshDelegationStatusUpdaterService,
    private readonly auditPublisher: MeshDelegationAuditPublisherService,
  ) {}

  async dispatchContract(
    contract: DelegationContract,
    params: MeshDelegationDispatchParams,
  ): Promise<boolean> {
    const now = new Date();

    try {
      const subagentExecutionId = await params.spawnHandler(
        toSpawnRequest(contract, params),
      );

      const updated = await this.statusUpdater.markDispatched({
        contract,
        subagentExecutionId,
        now,
      });

      await this.auditPublisher.appendLifecycleEvent({
        workflowRunId: contract.workflow_run_id,
        eventType: `${MESH_DELEGATION_EVENT_PREFIX}.dispatched`,
        actorId: contract.requester_agent_profile ?? undefined,
        payload: {
          contract_id: contract.id,
          subagent_execution_id: subagentExecutionId,
          trace_id: contract.trace_id,
          queue_priority: contract.queue_priority,
        },
      });

      await this.auditPublisher.writeAudit({
        contract: updated ?? contract,
        action: 'dispatch',
        result: 'success',
      });

      return true;
    } catch (error) {
      await this.handleDispatchFailure(contract, error);
      return false;
    }
  }

  private async handleDispatchFailure(
    contract: DelegationContract,
    error: unknown,
  ): Promise<void> {
    const errorMessage = resolveErrorMessage(error);
    const statusUpdate = await this.statusUpdater.markDispatchFailure({
      contract,
      errorMessage,
    });

    await this.auditPublisher.appendLifecycleEvent({
      workflowRunId: contract.workflow_run_id,
      eventType: statusUpdate.shouldRequeue
        ? `${MESH_DELEGATION_EVENT_PREFIX}.dispatch_failed_requeued`
        : `${MESH_DELEGATION_EVENT_PREFIX}.dispatch_failed`,
      actorId: contract.requester_agent_profile ?? undefined,
      payload: {
        contract_id: contract.id,
        trace_id: contract.trace_id,
        attempt_count: statusUpdate.nextAttemptCount,
        error: errorMessage,
      },
    });

    await this.auditPublisher.writeAudit({
      contract,
      action: 'dispatch',
      result: 'failure',
      metadata: {
        error: errorMessage,
        requeued: statusUpdate.shouldRequeue,
      },
    });
  }
}
