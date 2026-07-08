import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StandingOrderOverridePolicy } from '@nexus/core';
import { StandingOrderRepository } from './database/repositories/standing-order.repository';
import {
  toRuntimeStandingOrder,
  toStandingOrderSummary,
} from './standing-orders.view';
import type {
  CreateStandingOrderParams,
  ListStandingOrdersResult,
  RuntimeStandingOrderView,
  StandingOrdersPagination,
  StandingOrderSummaryView,
  UpdateStandingOrderParams,
} from './standing-orders.types';
import type { StandingOrder } from './database/entities/standing-order.entity';

@Injectable()
export class StandingOrdersService {
  constructor(
    private readonly standingOrderRepository: StandingOrderRepository,
  ) {}

  async listStandingOrders(params: {
    scopeId: string;
    profileName?: string;
    includeDisabled?: boolean;
    pagination: StandingOrdersPagination;
  }): Promise<ListStandingOrdersResult> {
    const { data, total } = await this.standingOrderRepository.findByScopeId(
      params.scopeId,
      params.pagination,
      {
        profileName: params.profileName,
        includeDisabled: params.includeDisabled,
      },
    );

    return {
      items: data.map((item) => toStandingOrderSummary(item)),
      total,
      limit: params.pagination.limit,
      offset: params.pagination.offset,
    };
  }

  async getStandingOrder(id: string): Promise<StandingOrderSummaryView> {
    const standingOrder = await this.requireStandingOrder(id);
    return toStandingOrderSummary(standingOrder);
  }

  async createStandingOrder(
    params: CreateStandingOrderParams,
  ): Promise<StandingOrderSummaryView> {
    const created = await this.standingOrderRepository.create({
      scopeId: params.scopeId,
      title: this.normalizeRequiredText(params.title, 'title', 180),
      instruction: this.normalizeRequiredText(
        params.instruction,
        'instruction',
      ),
      profile_name: this.normalizeOptionalText(params.profile_name, 120),
      enabled: params.enabled ?? true,
      priority: params.priority ?? 100,
      override_policy:
        params.override_policy ?? StandingOrderOverridePolicy.ADVISORY,
      created_by: params.created_by ?? null,
      updated_by: params.created_by ?? null,
    });

    return toStandingOrderSummary(created);
  }

  async updateStandingOrder(
    id: string,
    params: UpdateStandingOrderParams,
  ): Promise<StandingOrderSummaryView> {
    const existing = await this.requireStandingOrder(id);

    const updated = await this.standingOrderRepository.update(id, {
      title:
        params.title !== undefined
          ? this.normalizeRequiredText(params.title, 'title', 180)
          : existing.title,
      instruction:
        params.instruction !== undefined
          ? this.normalizeRequiredText(params.instruction, 'instruction')
          : existing.instruction,
      profile_name:
        params.profile_name !== undefined
          ? this.normalizeOptionalText(params.profile_name, 120)
          : existing.profile_name,
      enabled: params.enabled ?? existing.enabled,
      priority: params.priority ?? existing.priority,
      override_policy: params.override_policy ?? existing.override_policy,
      updated_by: params.updated_by ?? existing.updated_by,
    });

    if (!updated) {
      throw new NotFoundException(`Standing order ${id} not found`);
    }

    return toStandingOrderSummary(updated);
  }

  async deleteStandingOrder(id: string): Promise<void> {
    await this.requireStandingOrder(id);
    await this.standingOrderRepository.remove(id);
  }

  async getRuntimeStandingOrders(
    scopeId: string,
    profileName?: string,
  ): Promise<RuntimeStandingOrderView[]> {
    const orders = await this.standingOrderRepository.findActiveByScopeId(
      scopeId,
      profileName,
    );

    return orders.map((order) => toRuntimeStandingOrder(order));
  }

  private async requireStandingOrder(id: string): Promise<StandingOrder> {
    const standingOrder = await this.standingOrderRepository.findById(id);
    if (!standingOrder) {
      throw new NotFoundException(`Standing order ${id} not found`);
    }
    return standingOrder;
  }

  private normalizeRequiredText(
    value: string,
    fieldName: string,
    maxLength?: number,
  ): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new BadRequestException(`${fieldName} is required`);
    }

    if (maxLength && trimmed.length > maxLength) {
      throw new BadRequestException(
        `${fieldName} must be ${maxLength.toString()} characters or fewer`,
      );
    }

    return trimmed;
  }

  private normalizeOptionalText(
    value: string | undefined,
    maxLength: number,
  ): string | null {
    if (value === undefined) {
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    if (trimmed.length > maxLength) {
      throw new BadRequestException(
        `profile_name must be ${maxLength.toString()} characters or fewer`,
      );
    }

    return trimmed;
  }
}
