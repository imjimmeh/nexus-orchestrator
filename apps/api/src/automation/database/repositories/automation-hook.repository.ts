import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AutomationHookTriggerType } from '@nexus/core';
import { Repository } from 'typeorm';
import { AutomationHook } from '../entities/automation-hook.entity';

@Injectable()
export class AutomationHookRepository {
  constructor(
    @InjectRepository(AutomationHook)
    private readonly repository: Repository<AutomationHook>,
  ) {}

  async findById(id: string): Promise<AutomationHook | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByScopeId(scopeId: string): Promise<AutomationHook[]> {
    return this.repository.find({
      where: { scopeId: scopeId },
      order: {
        priority: 'ASC',
        created_at: 'DESC',
      },
    });
  }

  async findAll(params: {
    scopeId?: string;
    triggerType?: AutomationHookTriggerType;
    limit: number;
    offset: number;
  }): Promise<{ data: AutomationHook[]; total: number }> {
    const qb = this.repository
      .createQueryBuilder('hook')
      .orderBy('hook.priority', 'ASC')
      .addOrderBy('hook.created_at', 'DESC')
      .offset(params.offset)
      .limit(params.limit);

    if (params.scopeId) {
      qb.andWhere('hook.scope_id = :scopeId', {
        scopeId: params.scopeId,
      });
    }

    if (params.triggerType) {
      qb.andWhere('hook.trigger_type = :triggerType', {
        triggerType: params.triggerType,
      });
    }

    const [data, total] = await qb.getManyAndCount();
    return { data, total };
  }

  async findEnabledByScopeIdAndTrigger(
    scopeId: string,
    triggerType: AutomationHookTriggerType,
  ): Promise<AutomationHook[]> {
    return this.repository.find({
      where: {
        scopeId: scopeId,
        enabled: true,
        trigger_type: triggerType,
      },
      order: {
        priority: 'ASC',
        created_at: 'ASC',
      },
    });
  }

  async create(data: Partial<AutomationHook>): Promise<AutomationHook> {
    const entity = this.repository.create(data);
    return this.repository.save(entity);
  }

  async update(
    id: string,
    data: Partial<AutomationHook>,
  ): Promise<AutomationHook | null> {
    await this.repository.update(
      id,
      data as Parameters<typeof this.repository.update>[1],
    );
    return this.findById(id);
  }

  async setLastFiredAt(id: string, firedAt: Date): Promise<void> {
    await this.repository.update(id, { last_fired_at: firedAt });
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }
}
