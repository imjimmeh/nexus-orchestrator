import { Injectable } from '@nestjs/common';
import type {
  CreateModelRequest,
  ListModelsQuery,
  UpdateModelRequest,
} from '@nexus/core';
import { LlmModelRepository } from '../../database/repositories/llm-model.repository';
import { LlmModel } from '../../database/entities/llm-model.entity';
import { BaseCrudService } from './base-crud.service';

@Injectable()
export class ModelCrudService extends BaseCrudService<
  LlmModel,
  CreateModelRequest,
  UpdateModelRequest
> {
  constructor(repository: LlmModelRepository) {
    super(repository, 'Model');
  }

  async findAllPaginated(
    query: ListModelsQuery,
  ): Promise<{ data: LlmModel[]; total: number }> {
    const repo = this.repository as unknown as LlmModelRepository;
    return repo.findAllPaginated(query);
  }
}
