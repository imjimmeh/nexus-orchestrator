import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LlmModel } from '../entities/llm-model.entity';

export type { ModelUseCase } from './llm-model.repository.types';
import type { ModelUseCase } from './llm-model.repository.types';
import {
  applyPagination,
  applySearch,
  applySort,
} from '../../../common/utils/query-helpers';

const MODEL_ALLOWED_SORTS = [
  'name',
  'created_at',
  'is_active',
  'provider_name',
];

@Injectable()
export class LlmModelRepository {
  constructor(
    @InjectRepository(LlmModel)
    private readonly repository: Repository<LlmModel>,
  ) {}

  async findByName(name: string): Promise<LlmModel | null> {
    return this.repository.findOne({ where: { name, is_active: true } });
  }

  /**
   * Resolve an active model by provider and name, matched case-insensitively.
   *
   * Provider and model-name strings recorded against usage events are not
   * normalised (e.g. `deepseek` vs the configured `DeepSeek`), so an exact
   * match is unreliable. Including the provider disambiguates the case where
   * the same model name is configured under multiple providers with different
   * costs. The oldest matching row wins for deterministic resolution.
   */
  async findActiveByProviderAndName(
    providerName: string,
    name: string,
  ): Promise<LlmModel | null> {
    return this.repository
      .createQueryBuilder('model')
      .where('model.is_active = :isActive', { isActive: true })
      .andWhere('LOWER(model.provider_name) = LOWER(:providerName)', {
        providerName,
      })
      .andWhere('LOWER(model.name) = LOWER(:name)', { name })
      .orderBy('model.created_at', 'ASC')
      .getOne();
  }

  async findById(id: string): Promise<LlmModel | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findAll(): Promise<LlmModel[]> {
    return this.repository.find({ order: { created_at: 'DESC' } });
  }

  async findDefaultForUseCase(useCase: ModelUseCase): Promise<LlmModel | null> {
    const where: FindOptionsWhere<LlmModel> = { is_active: true };

    if (useCase === 'execution') {
      where.default_for_execution = true;
    } else if (useCase === 'distillation') {
      where.default_for_distillation = true;
    } else if (useCase === 'summarization') {
      where.default_for_summarization = true;
    } else {
      where.default_for_session = true;
    }

    return this.repository.findOne({ where });
  }

  async findDefaultForEmbedding(): Promise<LlmModel | null> {
    return this.repository.findOne({
      where: { is_active: true, default_for_embedding: true },
    });
  }

  async create(data: Partial<LlmModel>): Promise<LlmModel> {
    const model = this.repository.create(data);
    return this.repository.save(model);
  }

  async update(
    id: string,
    data: QueryDeepPartialEntity<LlmModel>,
  ): Promise<LlmModel | null> {
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
    providerName?: string;
  }): Promise<{ data: LlmModel[]; total: number }> {
    const qb = this.repository.createQueryBuilder('model');

    applySearch(qb, params.search, ['name', 'provider_name']);

    if (params.isActive !== undefined) {
      qb.andWhere('model.is_active = :isActive', { isActive: params.isActive });
    }
    if (params.providerName) {
      qb.andWhere('model.provider_name = :providerName', {
        providerName: params.providerName,
      });
    }

    const total = await qb.getCount();

    applySort(qb, params.sortBy, params.sortDir, MODEL_ALLOWED_SORTS);
    applyPagination(qb, params.page, params.limit);

    const data = await qb.getMany();
    return { data, total };
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
