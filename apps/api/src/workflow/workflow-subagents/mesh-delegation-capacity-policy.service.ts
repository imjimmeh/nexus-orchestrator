import { BadRequestException, Injectable } from '@nestjs/common';
import { DelegationContractRepository } from '../database/repositories/delegation-contract.repository';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { MESH_DELEGATION_ACTIVE_STATUSES } from './mesh-delegation.service.types';
import {
  DEFAULT_MESH_CONCURRENCY,
  DEFAULT_MESH_QUEUE_DEPTH,
} from './mesh-delegation.service.utils';

@Injectable()
export class MeshDelegationCapacityPolicyService {
  constructor(
    private readonly delegationRepo: DelegationContractRepository,
    private readonly systemSettings: SystemSettingsService,
  ) {}

  async ensureQueueDepthWithinLimit(
    workflowRunId: string,
    parentContainerId: string,
  ): Promise<void> {
    const maxQueueDepth = await this.systemSettings.get<number>(
      'agent_mesh_scheduler_max_queue_depth',
      DEFAULT_MESH_QUEUE_DEPTH,
    );

    const queuedCount = await this.countQueuedContracts(
      workflowRunId,
      parentContainerId,
    );

    if (queuedCount >= maxQueueDepth) {
      throw new BadRequestException(
        `Delegation queue is full for parent ${parentContainerId} (${queuedCount}/${maxQueueDepth})`,
      );
    }
  }

  async countRunningContracts(
    workflowRunId: string,
    parentContainerId: string,
  ): Promise<number> {
    return this.delegationRepo.countByParentAndStatus(
      workflowRunId,
      parentContainerId,
      [...MESH_DELEGATION_ACTIVE_STATUSES],
    );
  }

  async countQueuedContracts(
    workflowRunId: string,
    parentContainerId: string,
  ): Promise<number> {
    return this.delegationRepo.countByParentAndStatus(
      workflowRunId,
      parentContainerId,
      ['queued'],
    );
  }

  async resolveMaxConcurrentDelegations(): Promise<number> {
    const legacyFallback = await this.systemSettings.get<number>(
      'max_concurrent_subagents_per_workflow',
      DEFAULT_MESH_CONCURRENCY,
    );

    return this.systemSettings.get<number>(
      'agent_mesh_scheduler_max_concurrency',
      legacyFallback,
    );
  }

  async resolveAvailableSlots(params: {
    workflowRunId: string;
    parentContainerId: string;
  }): Promise<{
    runningCount: number;
    maxConcurrent: number;
    availableSlots: number;
  }> {
    const runningCount = await this.countRunningContracts(
      params.workflowRunId,
      params.parentContainerId,
    );
    const maxConcurrent = await this.resolveMaxConcurrentDelegations();

    return {
      runningCount,
      maxConcurrent,
      availableSlots: Math.max(0, maxConcurrent - runningCount),
    };
  }
}
