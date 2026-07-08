import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type {
  HarnessAuthType,
  HarnessCredentialRequirement,
  HarnessId,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/authorization/permissions.guard.js';
import { RequirePermission } from '../auth/authorization/require-permission.decorator.js';
import { ScopeService } from '../scope/scope.service.js';
import { HarnessCredentialBindingRepository } from './harness-credential-binding.repository.js';
import { HarnessCredentialBindingEntity } from './entities/harness-credential-binding.entity.js';
import { HarnessProviderRegistryService } from './harness-provider-registry.service.js';

interface BindCredentialDto {
  authType: HarnessAuthType;
  secretId: string;
  scopeNodeId?: string | null;
}

interface CredentialRequirementStatus extends HarnessCredentialRequirement {
  bound: boolean;
  boundAuthType?: HarnessAuthType;
}

@ApiTags('harness')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('harness')
export class HarnessCredentialController {
  constructor(
    private readonly registry: HarnessProviderRegistryService,
    private readonly bindings: HarnessCredentialBindingRepository,
    private readonly scope: ScopeService,
  ) {}

  @Get(':harnessId/credentials')
  @RequirePermission('settings:read')
  async listCredentials(
    @Param('harnessId') harnessId: string,
    @Query('scopeNodeId') scopeNodeId?: string,
  ): Promise<CredentialRequirementStatus[]> {
    const requirements =
      this.registry.resolve(harnessId as HarnessId).capabilities
        .requiredCredentials ?? [];
    const chain = await this.buildScopeChain(scopeNodeId);

    const statuses: CredentialRequirementStatus[] = [];
    for (const req of requirements) {
      const binding = await this.bindings.findForScopeChain(
        chain,
        harnessId,
        req.key,
      );
      statuses.push({
        ...req,
        bound: binding !== null,
        boundAuthType: binding?.authType,
      });
    }
    return statuses;
  }

  @Put(':harnessId/credentials/:key')
  @RequirePermission('settings:manage')
  bindCredential(
    @Param('harnessId') harnessId: string,
    @Param('key') key: string,
    @Body() body: BindCredentialDto,
  ): Promise<HarnessCredentialBindingEntity> {
    return this.bindings.upsert({
      scopeNodeId: body.scopeNodeId ?? null,
      harnessId,
      credentialKey: key,
      authType: body.authType,
      secretId: body.secretId,
    });
  }

  @Delete(':harnessId/credentials/:key')
  @HttpCode(204)
  @RequirePermission('settings:manage')
  async unbindCredential(
    @Param('harnessId') harnessId: string,
    @Param('key') key: string,
    @Query('scopeNodeId') scopeNodeId?: string,
  ): Promise<void> {
    const binding = await this.bindings.findBinding(
      scopeNodeId ?? null,
      harnessId,
      key,
    );
    if (binding) await this.bindings.remove(binding.id);
  }

  private async buildScopeChain(
    scopeNodeId: string | undefined,
  ): Promise<Array<string | null>> {
    if (!scopeNodeId) return [null];
    const ancestorsRootFirst = await this.scope.getAncestorIds(scopeNodeId);
    return [...ancestorsRootFirst.reverse(), null];
  }
}
