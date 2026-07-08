import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { CreateSecretSchema, UpdateSecretSchema } from '@nexus/core';
import type { CreateSecretRequest, UpdateSecretRequest } from '@nexus/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ScopeAccessService } from '../../auth/authorization/scope-access.service';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { AiConfigAdminService } from '../ai-config-admin.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@ApiTags('ai-config-secrets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai-config/secrets')
export class SecretsController {
  constructor(
    private readonly aiConfigAdmin: AiConfigAdminService,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  @Get()
  @RequirePermission('secrets:read')
  @ApiOperation({
    summary: 'List secret metadata (secret values are never returned)',
  })
  async listSecrets(
    @Query('scopeNodeId') scopeNodeId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    // Only owner_type === 'scope' secrets reference the multi-tenant scope
    // node hierarchy; global/user-owned secrets stay visible regardless
    // (enforced in SecretStoreRepository.findAll).
    const scopeIds = await this.scopeAccess.restrictToAccessibleScopes(
      req.user.userId,
      'secrets:read',
      scopeNodeId,
    );
    return {
      success: true,
      data: await this.aiConfigAdmin.listSecrets(scopeIds),
    };
  }

  @Get(':id')
  @RequirePermission('secrets:read')
  @ApiOperation({
    summary: 'Get secret metadata by ID (secret values are never returned)',
  })
  async getSecret(@Param('id') id: string) {
    return { success: true, data: await this.aiConfigAdmin.getSecret(id) };
  }

  @Post()
  @RequirePermission('secrets:create')
  @ApiOperation({ summary: 'Create encrypted provider secret payload' })
  async createSecret(@ZodBody(CreateSecretSchema) dto: unknown) {
    return {
      success: true,
      data: await this.aiConfigAdmin.createSecret(dto as CreateSecretRequest),
    };
  }

  @Patch(':id')
  @RequirePermission('secrets:update')
  @ApiOperation({ summary: 'Update encrypted provider secret payload' })
  async updateSecret(
    @Param('id') id: string,
    @ZodBody(UpdateSecretSchema) dto: unknown,
  ) {
    return {
      success: true,
      data: await this.aiConfigAdmin.updateSecret(
        id,
        dto as UpdateSecretRequest,
      ),
    };
  }

  @Delete(':id')
  @RequirePermission('secrets:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete secret metadata and encrypted payload' })
  async deleteSecret(@Param('id') id: string) {
    await this.aiConfigAdmin.deleteSecret(id);
  }
}
