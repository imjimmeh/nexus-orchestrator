import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WorkflowLifecycleResult } from '../entities/workflow-lifecycle-result.entity';

@Injectable()
export class WorkflowLifecycleResultRepository {
  constructor(
    @InjectRepository(WorkflowLifecycleResult)
    private readonly repository: Repository<WorkflowLifecycleResult>,
  ) {}

  async save(
    data: Partial<WorkflowLifecycleResult>,
  ): Promise<WorkflowLifecycleResult> {
    const entry = this.repository.create(data);
    return this.repository.save(entry);
  }

  async findByScope(scopeId: string): Promise<WorkflowLifecycleResult[]> {
    return this.repository.find({
      where: { scope_id: scopeId },
      order: { created_at: 'DESC' },
    });
  }

  async findFiltered(filters: {
    scopeId: string;
    contextId?: string;
    phase?: string;
    hook?: string;
  }): Promise<WorkflowLifecycleResult[]> {
    const queryBuilder = this.repository
      .createQueryBuilder('lr')
      .where('lr.scope_id = :scopeId', { scopeId: filters.scopeId })
      .orderBy('lr.created_at', 'DESC');

    if (filters.contextId) {
      queryBuilder.andWhere('lr.context_id = :contextId', {
        contextId: filters.contextId,
      });
    }

    if (filters.phase) {
      queryBuilder.andWhere('lr.phase = :phase', { phase: filters.phase });
    }

    if (filters.hook) {
      queryBuilder.andWhere('lr.hook = :hook', { hook: filters.hook });
    }

    return queryBuilder.getMany();
  }

  async findLatestByScopeAndPhase(
    scopeId: string,
    phase: string,
    hook: string,
  ): Promise<WorkflowLifecycleResult | null> {
    return this.repository.findOne({
      where: { scope_id: scopeId, phase, hook },
      order: { created_at: 'DESC' },
    });
  }
}
