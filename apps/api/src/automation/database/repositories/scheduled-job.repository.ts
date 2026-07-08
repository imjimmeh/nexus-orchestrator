import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ScheduledJobStatus } from '@nexus/core';
import type { ScheduledJobScope } from '@nexus/core';
import { Repository } from 'typeorm';
import { ScheduledJob } from '../entities/scheduled-job.entity';

interface ListScheduledJobsFilters {
  scopeId?: string;
  scope?: ScheduledJobScope;
  status?: ScheduledJobStatus;
}

interface ListScheduledJobsPagination {
  limit: number;
  offset: number;
}

@Injectable()
export class ScheduledJobRepository {
  constructor(
    @InjectRepository(ScheduledJob)
    private readonly repository: Repository<ScheduledJob>,
  ) {}

  async findById(id: string): Promise<ScheduledJob | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByIdAndScopeId(
    id: string,
    scopeId: string,
  ): Promise<ScheduledJob | null> {
    return this.repository.findOne({ where: { id, scopeId: scopeId } });
  }

  async findAll(
    filters: ListScheduledJobsFilters,
    pagination: ListScheduledJobsPagination,
  ): Promise<{ data: ScheduledJob[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('job')
      .orderBy('job.created_at', 'DESC')
      .offset(pagination.offset)
      .limit(pagination.limit);

    if (filters.scopeId) {
      qb.andWhere('job.scope_id = :scopeId', {
        scopeId: filters.scopeId,
      });
    }

    if (filters.scope) {
      qb.andWhere('job.schedule_scope = :scope', { scope: filters.scope });
    }

    if (filters.status) {
      qb.andWhere('job.status = :status', { status: filters.status });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findDueJobs(params: {
    now: Date;
    limit: number;
  }): Promise<ScheduledJob[]> {
    return this.repository
      .createQueryBuilder('job')
      .where('job.status = :status', { status: ScheduledJobStatus.ACTIVE })
      .andWhere('job.next_run_at IS NOT NULL')
      .andWhere('job.next_run_at <= :now', { now: params.now })
      .orderBy('job.next_run_at', 'ASC')
      .limit(params.limit)
      .getMany();
  }

  async create(data: Partial<ScheduledJob>): Promise<ScheduledJob> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: Partial<ScheduledJob>,
  ): Promise<ScheduledJob | null> {
    await this.repository.update(
      id,
      data as Parameters<typeof this.repository.update>[1],
    );
    return this.findById(id);
  }

  async advanceNextRunIfDue(params: {
    id: string;
    dueAt: Date;
    nextRunAt: Date | null;
  }): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(ScheduledJob)
      .set({
        next_run_at: params.nextRunAt,
      })
      .where('id = :id', { id: params.id })
      .andWhere('status = :status', { status: ScheduledJobStatus.ACTIVE })
      .andWhere('next_run_at = :dueAt', { dueAt: params.dueAt })
      .execute();

    return result.affected === 1;
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
