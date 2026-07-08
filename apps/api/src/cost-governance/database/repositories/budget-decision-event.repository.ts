import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { BudgetDecisionEvent } from '../entities/budget-decision-event.entity';

@Injectable()
export class BudgetDecisionEventRepository {
  constructor(
    @InjectRepository(BudgetDecisionEvent)
    private readonly repo: Repository<BudgetDecisionEvent>,
  ) {}

  async recordDecision(
    data: Partial<BudgetDecisionEvent>,
  ): Promise<BudgetDecisionEvent> {
    const entity = this.repo.create(data as DeepPartial<BudgetDecisionEvent>);
    return this.repo.save(entity);
  }

  async findByContext(
    contextType: string,
    contextId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<BudgetDecisionEvent[]> {
    return this.repo.find({
      where: { context_type: contextType, context_id: contextId },
      order: { created_at: 'DESC' as const },
      take: limit,
      skip: offset,
    });
  }

  async findLatestByContext(
    contextType: string,
    contextId: string,
  ): Promise<BudgetDecisionEvent | null> {
    const results = await this.repo.find({
      where: { context_type: contextType, context_id: contextId },
      order: { created_at: 'DESC' as const },
      take: 1,
    });
    return results[0] ?? null;
  }
}
