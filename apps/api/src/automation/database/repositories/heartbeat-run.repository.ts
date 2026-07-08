import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { HeartbeatRun } from '../entities/heartbeat-run.entity';

interface RunPagination {
  limit: number;
  offset: number;
}

@Injectable()
export class HeartbeatRunRepository {
  constructor(
    @InjectRepository(HeartbeatRun)
    private readonly repository: Repository<HeartbeatRun>,
  ) {}

  async findById(id: string): Promise<HeartbeatRun | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByHeartbeatProfileId(
    heartbeatProfileId: string,
    pagination: RunPagination,
  ): Promise<{ data: HeartbeatRun[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('run')
      .where('run.heartbeat_profile_id = :heartbeatProfileId', {
        heartbeatProfileId,
      })
      .orderBy('run.triggered_at', 'DESC')
      .offset(pagination.offset)
      .limit(pagination.limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findLatestByHeartbeatProfileIds(
    heartbeatProfileIds: string[],
  ): Promise<HeartbeatRun[]> {
    if (heartbeatProfileIds.length === 0) {
      return [];
    }

    return this.repository
      .createQueryBuilder('run')
      .distinctOn(['run.heartbeat_profile_id'])
      .where('run.heartbeat_profile_id IN (:...heartbeatProfileIds)', {
        heartbeatProfileIds,
      })
      .orderBy('run.heartbeat_profile_id', 'ASC')
      .addOrderBy('run.triggered_at', 'DESC')
      .getMany();
  }

  async create(data: Partial<HeartbeatRun>): Promise<HeartbeatRun> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async createIfNotExistsByDueKey(
    data: Partial<HeartbeatRun>,
  ): Promise<HeartbeatRun | null> {
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
    data: QueryDeepPartialEntity<HeartbeatRun>,
  ): Promise<HeartbeatRun | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async updateByWorkflowRunId(
    workflowRunId: string,
    data: QueryDeepPartialEntity<HeartbeatRun>,
  ): Promise<void> {
    await this.repository.update(
      {
        workflow_run_id: workflowRunId,
      },
      data,
    );
  }

  async removeByHeartbeatProfileId(heartbeatProfileId: string): Promise<void> {
    await this.repository.delete({ heartbeat_profile_id: heartbeatProfileId });
  }
}
