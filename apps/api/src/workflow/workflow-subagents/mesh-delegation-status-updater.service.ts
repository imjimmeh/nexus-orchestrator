import { Injectable } from '@nestjs/common';
import type {
  DelegationContract,
  DelegationContractStatus,
} from '../database/entities/delegation-contract.entity';
import { DelegationContractRepository } from '../database/repositories/delegation-contract.repository';
import { resolveDeadline } from './mesh-delegation.service.utils';

@Injectable()
export class MeshDelegationStatusUpdaterService {
  constructor(private readonly delegationRepo: DelegationContractRepository) {}

  async markDispatched(params: {
    contract: DelegationContract;
    subagentExecutionId: string;
    now: Date;
  }): Promise<DelegationContract | null> {
    return this.delegationRepo.update(params.contract.id, {
      status: 'running',
      subagent_execution_id: params.subagentExecutionId,
      started_at: params.now,
      deadline_at: resolveDeadline(
        params.now,
        params.contract.time_budget_ms ?? null,
      ),
      attempt_count: params.contract.attempt_count + 1,
      last_error: null,
    });
  }

  async markDispatchFailure(params: {
    contract: DelegationContract;
    errorMessage: string;
  }): Promise<{
    nextAttemptCount: number;
    shouldRequeue: boolean;
    nextStatus: DelegationContractStatus;
  }> {
    const nextAttemptCount = params.contract.attempt_count + 1;
    const shouldRequeue = nextAttemptCount <= params.contract.max_retries;
    const nextStatus: DelegationContractStatus = shouldRequeue
      ? 'queued'
      : 'failed';

    await this.delegationRepo.update(params.contract.id, {
      status: nextStatus,
      attempt_count: nextAttemptCount,
      completed_at: shouldRequeue ? null : new Date(),
      last_error: params.errorMessage,
      subagent_execution_id: shouldRequeue
        ? null
        : params.contract.subagent_execution_id,
    });

    return { nextAttemptCount, shouldRequeue, nextStatus };
  }

  async requeueTimedOutContract(contractId: string): Promise<void> {
    await this.delegationRepo.update(contractId, {
      status: 'queued',
      subagent_execution_id: null,
      deadline_at: null,
      completed_at: null,
      last_error: 'timed_out',
    });
  }

  async markTimedOutContract(contractId: string): Promise<void> {
    await this.delegationRepo.update(contractId, {
      status: 'timed_out',
      completed_at: new Date(),
      last_error: 'timed_out',
    });
  }
}
