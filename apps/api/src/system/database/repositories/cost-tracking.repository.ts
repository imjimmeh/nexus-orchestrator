import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CostTracking } from '../entities/cost-tracking.entity';

@Injectable()
export class CostTrackingRepository {
  constructor(
    @InjectRepository(CostTracking)
    private readonly repository: Repository<CostTracking>,
  ) {}

  async recordCost(data: Partial<CostTracking>): Promise<CostTracking> {
    const entry = this.repository.create(data);
    return this.repository.save(entry);
  }

  async getSummary(
    startDate: Date,
    endDate: Date,
  ): Promise<Record<string, unknown>[]> {
    return this.repository
      .createQueryBuilder('cost')
      .select('cost.resource_type', 'type')
      .addSelect('SUM(cost.cost_usd)', 'total_cost')
      .where('cost.timestamp BETWEEN :start AND :end', {
        start: startDate,
        end: endDate,
      })
      .groupBy('cost.resource_type')
      .getRawMany();
  }
}
