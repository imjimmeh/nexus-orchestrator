import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { BudgetPolicyRepository } from './database/repositories/budget-policy.repository';
import {
  createBudgetPolicySchema,
  updateBudgetPolicySchema,
} from './dto/budget-policy.dto';
import type {
  CreateBudgetPolicyDto,
  UpdateBudgetPolicyDto,
} from './dto/budget-policy.dto.types';
import type { BudgetPolicy } from './database/entities/budget-policy.entity';

const VALID_ENFORCEMENT_MODES = [
  'observe',
  'warn',
  'approval_required',
  'block',
];

@Injectable()
export class BudgetPolicyService {
  private readonly logger = new Logger(BudgetPolicyService.name);

  constructor(private readonly repo: BudgetPolicyRepository) {}

  async create(dto: CreateBudgetPolicyDto): Promise<BudgetPolicy> {
    if (!VALID_ENFORCEMENT_MODES.includes(dto.enforcement_mode)) {
      throw new BadRequestException(
        `Invalid enforcement_mode: ${dto.enforcement_mode}. Must be one of: ${VALID_ENFORCEMENT_MODES.join(', ')}`,
      );
    }

    const parsed = createBudgetPolicySchema.parse(dto);
    return this.repo.createPolicy(parsed);
  }

  async getById(id: string): Promise<BudgetPolicy> {
    const policy = await this.repo.findById(id);
    if (!policy) {
      throw new NotFoundException(`Budget policy ${id} not found`);
    }
    return policy;
  }

  async update(id: string, dto: UpdateBudgetPolicyDto): Promise<BudgetPolicy> {
    await this.getById(id);

    const parsed = updateBudgetPolicySchema.parse(dto);

    const updated = await this.repo.updatePolicy(id, parsed);
    if (!updated) {
      throw new NotFoundException(`Budget policy ${id} not found after update`);
    }
    return updated;
  }

  async disable(id: string): Promise<void> {
    await this.getById(id);
    await this.repo.disablePolicy(id);
  }

  async delete(id: string): Promise<void> {
    await this.getById(id);
    await this.repo.deletePolicy(id);
  }

  async listAll(scopeIds?: string[]): Promise<BudgetPolicy[]> {
    return this.repo.findAllActive(scopeIds ? { scopeIds } : undefined);
  }

  async listByScope(
    scopeType: string,
    scopeId: string | null,
  ): Promise<BudgetPolicy[]> {
    return this.repo.findActiveByScope(scopeType, scopeId);
  }
}
