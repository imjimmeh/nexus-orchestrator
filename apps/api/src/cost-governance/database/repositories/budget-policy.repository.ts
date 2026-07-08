import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import type { DeepPartial } from 'typeorm';
import { BudgetPolicy } from '../entities/budget-policy.entity';
import type {
  CreateBudgetPolicyDto,
  UpdateBudgetPolicyDto,
} from '../../dto/budget-policy.dto.types';

@Injectable()
export class BudgetPolicyRepository {
  constructor(
    @InjectRepository(BudgetPolicy)
    private readonly repo: Repository<BudgetPolicy>,
  ) {}

  async createPolicy(data: CreateBudgetPolicyDto): Promise<BudgetPolicy> {
    const entity = this.repo.create(data as DeepPartial<BudgetPolicy>);
    return this.repo.save(entity);
  }

  async findById(id: string): Promise<BudgetPolicy | null> {
    return this.repo.findOneBy({ id });
  }

  async findActiveByScope(
    scopeType: string,
    scopeId: string | null,
  ): Promise<BudgetPolicy[]> {
    return this.repo.find({
      where: {
        scope_type: scopeType,
        scope_id: scopeId === null ? IsNull() : scopeId,
        is_active: true,
      },
      order: { created_at: 'DESC' },
    });
  }

  async findAllActive(options?: {
    scopeIds?: string[];
  }): Promise<BudgetPolicy[]> {
    const queryBuilder = this.repo
      .createQueryBuilder('budget_policy')
      .where('budget_policy.is_active = :isActive', { isActive: true })
      .orderBy('budget_policy.created_at', 'DESC');

    // Only scope_type === 'scope' rows reference the multi-tenant scope node
    // hierarchy; other scope_types (global/context/workflow_definition/
    // agent_profile) are not scope-node-partitioned and stay visible,
    // matching the "platform/NULL stays visible" pattern used elsewhere
    // (e.g. WorkflowController.findAll).
    if (options?.scopeIds !== undefined) {
      if (options.scopeIds.length > 0) {
        queryBuilder.andWhere(
          "(budget_policy.scope_type != 'scope' OR budget_policy.scope_id = ANY(:scopeIds))",
          { scopeIds: options.scopeIds },
        );
      } else {
        queryBuilder.andWhere("budget_policy.scope_type != 'scope'");
      }
    }

    return queryBuilder.getMany();
  }

  async updatePolicy(
    id: string,
    data: UpdateBudgetPolicyDto,
  ): Promise<BudgetPolicy | null> {
    await this.repo.update(id, data);
    return this.findById(id);
  }

  async disablePolicy(id: string): Promise<void> {
    await this.repo.update(id, { is_active: false });
  }

  async deletePolicy(id: string): Promise<void> {
    const entity = await this.findById(id);
    if (entity) {
      await this.repo.remove(entity);
    }
  }
}
