import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DelegationContract } from '../database/entities/delegation-contract.entity';
import { DelegationContractRepository } from '../database/repositories/delegation-contract.repository';
import { MESH_DELEGATION_QUEUE_STATUS } from './mesh-delegation.service.types';

@Injectable()
export class MeshDelegationCandidateQueryService {
  constructor(private readonly delegationRepo: DelegationContractRepository) {}

  async findQueuedContracts(params: {
    workflowRunId: string;
    parentContainerId: string;
    limit: number;
  }): Promise<DelegationContract[]> {
    return this.delegationRepo.findByParentAndStatus(
      params.workflowRunId,
      params.parentContainerId,
      [MESH_DELEGATION_QUEUE_STATUS],
      params.limit,
    );
  }

  async findExpiredContracts(
    workflowRunId?: string,
  ): Promise<DelegationContract[]> {
    return this.delegationRepo.findExpiredContracts(
      ['queued', 'running'],
      new Date(),
      workflowRunId,
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
    const traceId = randomUUID();

    if (!params.parentDelegationId) {
      const parentTraceId = params.parentTraceId;
      return {
        traceId,
        parentTraceId,
        lineageDepth: parentTraceId ? 1 : 0,
        lineagePath: parentTraceId ? [parentTraceId, traceId] : [traceId],
      };
    }

    const parentContract = await this.delegationRepo.findById(
      params.parentDelegationId,
    );
    if (!parentContract) {
      throw new BadRequestException(
        `Parent delegation contract ${params.parentDelegationId} not found`,
      );
    }

    const parentLineagePath =
      parentContract.lineage_path && parentContract.lineage_path.length > 0
        ? parentContract.lineage_path
        : [parentContract.trace_id];

    return {
      traceId,
      parentTraceId: parentContract.trace_id,
      lineageDepth: parentContract.lineage_depth + 1,
      lineagePath: [...parentLineagePath, traceId],
    };
  }
}
