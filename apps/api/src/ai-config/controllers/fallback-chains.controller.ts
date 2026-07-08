import {
  BadRequestException,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import type { FallbackChain, ProviderCooldownStatus } from '@nexus/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import {
  FallbackChainRepository,
  GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME,
} from '../database/repositories/fallback-chain.repository';
import { ProviderCooldownRepository } from '../database/repositories/provider-cooldown.repository';
import { LlmProviderRepository } from '../database/repositories/llm-provider.repository';
import { LlmModelRepository } from '../database/repositories/llm-model.repository';
import { PutGlobalFallbackChainSchema } from '../dto/fallback-chain.dto';
import type { PutGlobalFallbackChainRequest } from '../dto/fallback-chain.dto.types';

@ApiTags('ai-config-fallback')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai-config')
export class FallbackChainsController {
  constructor(
    private readonly fallbackChainRepo: FallbackChainRepository,
    private readonly cooldownRepo: ProviderCooldownRepository,
    private readonly providersRepo: LlmProviderRepository,
    private readonly modelsRepo: LlmModelRepository,
  ) {}

  @Get('fallback-chains/global')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get the global default fallback chain' })
  async getGlobalChain(): Promise<{ success: true; data: FallbackChain }> {
    const entity = await this.fallbackChainRepo.findByName(
      GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME,
    );
    return {
      success: true,
      data: entity
        ? { name: entity.name, entries: entity.entries }
        : { name: GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME, entries: [] },
    };
  }

  @Put('fallback-chains/global')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Replace the global default fallback chain' })
  async putGlobalChain(
    @ZodBody(PutGlobalFallbackChainSchema) dto: PutGlobalFallbackChainRequest,
  ): Promise<{ success: true; data: FallbackChain }> {
    for (const entry of dto.entries) {
      const provider = await this.providersRepo.findByName(entry.provider_name);
      if (!provider) {
        throw new BadRequestException(
          `Unknown provider: ${entry.provider_name}`,
        );
      }
      const model = await this.modelsRepo.findByName(entry.model_name);
      if (!model) {
        throw new BadRequestException(`Unknown model: ${entry.model_name}`);
      }
    }

    const entity = await this.fallbackChainRepo.upsert(
      GLOBAL_DEFAULT_FALLBACK_CHAIN_NAME,
      dto.entries,
    );
    return {
      success: true,
      data: { name: entity.name, entries: entity.entries },
    };
  }

  @Get('provider-cooldowns')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List active provider cooldowns' })
  async getProviderCooldowns(): Promise<{
    success: true;
    data: ProviderCooldownStatus[];
  }> {
    const active = await this.cooldownRepo.findActive(new Date());
    return {
      success: true,
      data: active.map((c) => ({
        provider_name: c.provider_name,
        reason: c.reason,
        cooled_until: c.cooled_until.toISOString(),
        last_failure_at: c.last_failure_at.toISOString(),
        source_run_id: c.source_run_id ?? null,
      })),
    };
  }
}
