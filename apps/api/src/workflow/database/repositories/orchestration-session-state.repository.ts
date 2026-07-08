import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { OrchestrationSessionState } from '../entities/orchestration-session-state.entity';

@Injectable()
export class OrchestrationSessionStateRepository {
  constructor(
    @InjectRepository(OrchestrationSessionState)
    private readonly repository: Repository<OrchestrationSessionState>,
  ) {}

  findByScopeId(scopeId: string): Promise<OrchestrationSessionState | null> {
    return this.repository.findOne({ where: { scopeId } });
  }

  async create(
    data: Partial<OrchestrationSessionState>,
  ): Promise<OrchestrationSessionState> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async updateByScopeId(
    scopeId: string,
    data: Partial<OrchestrationSessionState>,
  ): Promise<OrchestrationSessionState | null> {
    await this.repository.update(
      { scopeId },
      data as QueryDeepPartialEntity<OrchestrationSessionState>,
    );
    return this.findByScopeId(scopeId);
  }

  async findByScopeIdForUpdate(
    scopeId: string,
  ): Promise<OrchestrationSessionState | null> {
    return this.repository.manager.transaction(async (manager) =>
      manager.findOne(OrchestrationSessionState, {
        where: { scopeId },
        lock: { mode: 'pessimistic_write' },
      }),
    );
  }
}
