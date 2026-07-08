import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LlmProvider } from '../entities/llm-provider.entity';
import {
  applyPagination,
  applySearch,
  applySort,
} from '../../../common/utils/query-helpers';
import type { FindActiveByOwnerAndNameParams } from './llm-provider.repository.types';

const PROVIDER_ALLOWED_SORTS = ['name', 'created_at', 'is_active', 'auth_type'];

@Injectable()
export class LlmProviderRepository {
  constructor(
    @InjectRepository(LlmProvider)
    private readonly repository: Repository<LlmProvider>,
  ) {}

  async findByName(name: string): Promise<LlmProvider | null> {
    return this.repository.findOne({
      where: { name, is_active: true, owner_type: 'global' },
    });
  }

  async findByProviderId(providerId: string): Promise<LlmProvider | null> {
    return this.repository.findOne({
      where: { provider_id: providerId, is_active: true, owner_type: 'global' },
    });
  }

  async findById(id: string): Promise<LlmProvider | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findActiveByOwnerAndName(
    params: FindActiveByOwnerAndNameParams,
  ): Promise<LlmProvider | null> {
    return this.repository.findOne({
      where: {
        is_active: true,
        owner_type: params.ownerType,
        owner_id: params.ownerId ?? IsNull(),
        name: params.name,
      },
    });
  }

  async findAll(): Promise<LlmProvider[]> {
    return this.repository.find({ order: { created_at: 'DESC' } });
  }

  async create(data: Partial<LlmProvider>): Promise<LlmProvider> {
    const provider = this.repository.create(data);
    return this.repository.save(provider);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<LlmProvider>,
  ): Promise<LlmProvider | null> {
    await this.repository.update(id, data);
    return this.findById(id);
  }

  async findAllPaginated(params: {
    page: number;
    limit: number;
    search?: string;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
    isActive?: boolean;
    authType?: string;
    scopeIds?: string[];
  }): Promise<{ data: LlmProvider[]; total: number }> {
    const qb = this.repository.createQueryBuilder('provider');

    applySearch(qb, params.search, ['name', 'auth_type']);

    if (params.isActive !== undefined) {
      qb.andWhere('provider.is_active = :isActive', {
        isActive: params.isActive,
      });
    }
    if (params.authType) {
      qb.andWhere('provider.auth_type = :authType', {
        authType: params.authType,
      });
    }

    // Only owner_type === 'scope' providers reference the multi-tenant scope
    // node hierarchy; global/user-owned providers are not scope-node-
    // partitioned and stay visible, matching the "platform/NULL stays
    // visible" pattern used elsewhere (e.g. WorkflowController.findAll).
    if (params.scopeIds !== undefined) {
      if (params.scopeIds.length > 0) {
        qb.andWhere(
          "(provider.owner_type != 'scope' OR provider.owner_id = ANY(:scopeIds))",
          { scopeIds: params.scopeIds },
        );
      } else {
        qb.andWhere("provider.owner_type != 'scope'");
      }
    }

    const total = await qb.getCount();

    applySort(qb, params.sortBy, params.sortDir, PROVIDER_ALLOWED_SORTS);
    applyPagination(qb, params.page, params.limit);

    const data = await qb.getMany();
    return { data, total };
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
