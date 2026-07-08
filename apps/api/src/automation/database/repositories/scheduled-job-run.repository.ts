import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { ScheduledJobRun } from '../entities/scheduled-job-run.entity';

interface RunPagination {
  limit: number;
  offset: number;
}

@Injectable()
export class ScheduledJobRunRepository {
  constructor(
    @InjectRepository(ScheduledJobRun)
    private readonly repository: Repository<ScheduledJobRun>,
  ) {}

  async findById(id: string): Promise<ScheduledJobRun | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByScheduledJobId(
    scheduledJobId: string,
    pagination: RunPagination,
  ): Promise<{ data: ScheduledJobRun[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('run')
      .where('run.scheduled_job_id = :scheduledJobId', { scheduledJobId })
      .orderBy('run.triggered_at', 'DESC')
      .offset(pagination.offset)
      .limit(pagination.limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findLatestByScheduledJobIds(
    scheduledJobIds: string[],
  ): Promise<ScheduledJobRun[]> {
    if (scheduledJobIds.length === 0) {
      return [];
    }

    return this.repository
      .createQueryBuilder('run')
      .distinctOn(['run.scheduled_job_id'])
      .where('run.scheduled_job_id IN (:...scheduledJobIds)', {
        scheduledJobIds,
      })
      .orderBy('run.scheduled_job_id', 'ASC')
      .addOrderBy('run.triggered_at', 'DESC')
      .getMany();
  }

  async create(data: Partial<ScheduledJobRun>): Promise<ScheduledJobRun> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async createIfNotExistsByDueKey(
    data: Partial<ScheduledJobRun>,
  ): Promise<ScheduledJobRun | null> {
    try {
      const entity = this.repository.create(data);
      return await this.repository.save(entity);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes('duplicate key value violates unique constraint')
      ) {
        return null;
      }
      throw error;
    }
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<ScheduledJobRun>,
  ): Promise<ScheduledJobRun | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async updateByWorkflowRunId(
    workflowRunId: string,
    data: QueryDeepPartialEntity<ScheduledJobRun>,
  ): Promise<void> {
    await this.repository.update(
      {
        workflow_run_id: workflowRunId,
      },
      data,
    );
  }

  async removeByScheduledJobId(scheduledJobId: string): Promise<void> {
    await this.repository.delete({ scheduled_job_id: scheduledJobId });
  }
}
