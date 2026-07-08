import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalServiceScopeGuard } from '../../auth/internal-service-scope.guard';
import { InternalServiceScopes } from '../../auth/internal-service-scopes.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { AiConfigAdminService } from '../ai-config-admin.service';
import { AiConfigurationService } from '../ai-configuration.service';
import { AgentProfileResolutionService } from '../services/agent-profile-resolution.service';

@ApiTags('internal')
@Controller('internal/models')
@UseGuards(InternalServiceScopeGuard, JwtAuthGuard, PermissionsGuard)
@RequirePermission('agents:read')
export class ModelsInternalController {
  constructor(
    private readonly aiConfigAdmin: AiConfigAdminService,
    private readonly aiConfigurationService: AiConfigurationService,
    private readonly profileResolution: AgentProfileResolutionService,
  ) {}

  @Get('rates')
  @InternalServiceScopes('core.models:read')
  @ApiOperation({
    summary:
      'List active model pricing rates for service-to-service cost estimation (internal use only)',
  })
  async getRates() {
    return { rates: await this.aiConfigAdmin.getActiveModelRates() };
  }

  @Get('resolve')
  @InternalServiceScopes('core.models:read')
  @ApiOperation({
    summary:
      'Resolve the effective model for an agent profile and scope (internal use only)',
  })
  async resolveModel(
    @Query('agentProfileName') agentProfileName?: string,
    @Query('scopeNodeId') scopeNodeId?: string,
  ) {
    let resolvedModelName: string | null = null;
    let resolvedProviderName: string | null = null;

    if (agentProfileName) {
      try {
        const effective = await this.profileResolution.resolve(
          agentProfileName,
          scopeNodeId ?? null,
        );
        if (effective?.value) {
          resolvedModelName = effective.value.model_name ?? null;
          resolvedProviderName = effective.value.provider_name ?? null;
        }
      } catch {
        // Fallback or ignore if profile not found or resolution fails
      }
    }

    if (!resolvedModelName) {
      resolvedModelName =
        await this.aiConfigurationService.getModelForUseCase('execution');
      if (resolvedModelName) {
        const model =
          await this.aiConfigurationService.getModelByName(resolvedModelName);
        resolvedProviderName = model?.provider_name ?? null;
      }
    }

    return {
      modelName: resolvedModelName,
      providerName: resolvedProviderName,
    };
  }
}
