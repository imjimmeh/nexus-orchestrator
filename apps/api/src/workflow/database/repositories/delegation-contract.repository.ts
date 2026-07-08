import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { DelegationContract } from '../entities/delegation-contract.entity';
import type { DelegationContractStatus } from '../entities/delegation-contract.entity';

@Injectable()
export class DelegationContractRepository {
  constructor(
    @InjectRepository(DelegationContract)
    private readonly repository: Repository<DelegationContract>,
  ) {}

  async create(data: Partial<DelegationContract>): Promise<DelegationContract> {
    const contract = this.repository.create(data);
    return this.repository.save(contract);
  }

  async findById(id: string): Promise<DelegationContract | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findBySubagentExecutionId(
    subagentExecutionId: string,
  ): Promise<DelegationContract | null> {
    return this.repository.findOne({
      where: {
        subagent_execution_id: subagentExecutionId,
      },
    });
  }

  async findByWorkflowRunId(
    workflowRunId: string,
    limit = 100,
    offset = 0,
  ): Promise<[DelegationContract[], number]> {
    return this.repository.findAndCount({
      where: { workflow_run_id: workflowRunId },
      order: { created_at: 'DESC' },
      take: limit,
      skip: offset,
    });
  }

  async findByParentAndStatus(
    workflowRunId: string,
    parentContainerId: string,
    statuses: DelegationContractStatus[],
    limit: number,
  ): Promise<DelegationContract[]> {
    if (statuses.length === 0 || limit <= 0) {
      return [];
    }

    return this.repository.find({
      where: {
        workflow_run_id: workflowRunId,
        parent_container_id: parentContainerId,
        status: In(statuses),
      },
      order: {
        queue_priority: 'DESC',
        created_at: 'ASC',
      },
      take: limit,
    });
  }

  async countByParentAndStatus(
    workflowRunId: string,
    parentContainerId: string,
    statuses: DelegationContractStatus[],
  ): Promise<number> {
    if (statuses.length === 0) {
      return 0;
    }

    return this.repository.count({
      where: {
        workflow_run_id: workflowRunId,
        parent_container_id: parentContainerId,
        status: In(statuses),
      },
    });
  }

  async findExpiredContracts(
    statuses: DelegationContractStatus[],
    now: Date,
    workflowRunId?: string,
  ): Promise<DelegationContract[]> {
    if (statuses.length === 0) {
      return [];
    }

    const queryBuilder = this.repository
      .createQueryBuilder('contract')
      .where('contract.status IN (:...statuses)', { statuses })
      .andWhere('contract.deadline_at IS NOT NULL')
      .andWhere('contract.deadline_at <= :deadlineAt', { deadlineAt: now });

    if (workflowRunId) {
      queryBuilder.andWhere('contract.workflow_run_id = :workflowRunId', {
        workflowRunId,
      });
    }

    return queryBuilder
      .orderBy('contract.deadline_at', 'ASC')
      .addOrderBy('contract.created_at', 'ASC')
      .getMany();
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<DelegationContract>,
  ): Promise<DelegationContract | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }
}
