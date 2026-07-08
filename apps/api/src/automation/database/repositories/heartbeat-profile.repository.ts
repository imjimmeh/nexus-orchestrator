import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HeartbeatProfile } from '../entities/heartbeat-profile.entity';

interface HeartbeatProfilePagination {
  limit: number;
  offset: number;
}

@Injectable()
export class HeartbeatProfileRepository {
  constructor(
    @InjectRepository(HeartbeatProfile)
    private readonly repository: Repository<HeartbeatProfile>,
  ) {}

  async findById(id: string): Promise<HeartbeatProfile | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByScopeId(
    scopeId: string,
    pagination: HeartbeatProfilePagination,
  ): Promise<{ data: HeartbeatProfile[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('profile')
      .where('profile.scope_id = :scopeId', { scopeId })
      .orderBy('profile.created_at', 'DESC')
      .offset(pagination.offset)
      .limit(pagination.limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findDueProfiles(params: {
    now: Date;
    limit: number;
  }): Promise<HeartbeatProfile[]> {
    return this.repository
      .createQueryBuilder('profile')
      .where('profile.enabled = :enabled', { enabled: true })
      .andWhere('profile.next_run_at IS NOT NULL')
      .andWhere('profile.next_run_at <= :now', { now: params.now })
      .orderBy('profile.next_run_at', 'ASC')
      .limit(params.limit)
      .getMany();
  }

  async create(data: Partial<HeartbeatProfile>): Promise<HeartbeatProfile> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: Partial<HeartbeatProfile>,
  ): Promise<HeartbeatProfile | null> {
    await this.repository.update(
      id,
      data as Parameters<typeof this.repository.update>[1],
    );
    return this.findById(id);
  }

  async advanceNextRunIfDue(params: {
    id: string;
    dueAt: Date;
    nextRunAt: Date;
    lastRunAt: Date;
  }): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(HeartbeatProfile)
      .set({
        next_run_at: params.nextRunAt,
        last_run_at: params.lastRunAt,
      })
      .where('id = :id', { id: params.id })
      .andWhere('enabled = :enabled', { enabled: true })
      .andWhere('next_run_at = :dueAt', { dueAt: params.dueAt })
      .execute();

    return result.affected === 1;
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
