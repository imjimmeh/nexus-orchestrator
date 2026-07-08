import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StandingOrder } from '../entities/standing-order.entity';

interface StandingOrderPagination {
  limit: number;
  offset: number;
}

@Injectable()
export class StandingOrderRepository {
  constructor(
    @InjectRepository(StandingOrder)
    private readonly repository: Repository<StandingOrder>,
  ) {}

  async findById(id: string): Promise<StandingOrder | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByScopeId(
    scopeId: string,
    pagination: StandingOrderPagination,
    options?: {
      profileName?: string;
      includeDisabled?: boolean;
    },
  ): Promise<{ data: StandingOrder[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('order')
      .where('order.scope_id = :scopeId', { scopeId })
      .orderBy('order.priority', 'ASC')
      .addOrderBy('order.created_at', 'DESC');

    if (!options?.includeDisabled) {
      qb.andWhere('order.enabled = :enabled', { enabled: true });
    }

    if (options?.profileName && options.profileName.trim().length > 0) {
      qb.andWhere('order.profile_name = :profileName', {
        profileName: options.profileName.trim(),
      });
    }

    qb.offset(pagination.offset).limit(pagination.limit);

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findActiveByScopeId(
    scopeId: string,
    profileName?: string,
  ): Promise<StandingOrder[]> {
    const qb = this.repository
      .createQueryBuilder('order')
      .where('order.scope_id = :scopeId', { scopeId })
      .andWhere('order.enabled = :enabled', { enabled: true })
      .orderBy('order.priority', 'ASC')
      .addOrderBy('order.created_at', 'ASC');

    if (profileName && profileName.trim().length > 0) {
      qb.andWhere(
        '(order.profile_name IS NULL OR order.profile_name = :profileName)',
        { profileName: profileName.trim() },
      );
    }

    return qb.getMany();
  }

  async create(data: Partial<StandingOrder>): Promise<StandingOrder> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: Partial<StandingOrder>,
  ): Promise<StandingOrder | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
