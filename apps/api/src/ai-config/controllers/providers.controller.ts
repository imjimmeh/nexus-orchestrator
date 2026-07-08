import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  CreateProviderSchema,
  ListProvidersQuerySchema,
  StartProviderOAuthRequestSchema,
  SubmitOAuthCodeRequestSchema,
  UpdateProviderSchema,
} from '@nexus/core';
import type {
  CreateProviderRequest,
  ListProvidersQuery,
  StartProviderOAuthRequest,
  SubmitOAuthCodeRequest,
  UpdateProviderRequest,
} from '@nexus/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ScopeAccessService } from '../../auth/authorization/scope-access.service';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { AiConfigAdminService } from '../ai-config-admin.service';
import { ProviderOAuthLinkService } from '../services/provider-oauth-link.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@ApiTags('ai-config-providers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai-config/providers')
export class ProvidersController {
  constructor(
    private readonly aiConfigAdmin: AiConfigAdminService,
    private readonly oauthLink: ProviderOAuthLinkService,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  @Get()
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List LLM providers' })
  async listProviders(
    @ZodQuery(ListProvidersQuerySchema) query: ListProvidersQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    const { scopeNodeId, ...rest } = query;

    // Only owner_type === 'scope' providers reference the multi-tenant scope
    // node hierarchy; global/user-owned providers stay visible regardless
    // (enforced in LlmProviderRepository.findAllPaginated).
    const scopeIds = await this.scopeAccess.restrictToAccessibleScopes(
      req.user.userId,
      'agents:read',
      scopeNodeId,
    );
    return this.aiConfigAdmin.listProvidersPaginated({ ...rest, scopeIds });
  }

  @Get('presets')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List LLM provider presets supported by pi-runner' })
  async listPresets() {
    return this.aiConfigAdmin.listProviderPresets();
  }

  @Post(':id/oauth/start')
  @RequirePermission('agents:manage')
  @ApiOperation({
    summary: 'Start an OAuth login (device-code or authorization-code)',
  })
  async startOAuth(
    @Param('id') id: string,
    @ZodBody(StartProviderOAuthRequestSchema) body: StartProviderOAuthRequest,
  ) {
    return {
      success: true,
      data: await this.oauthLink.start({
        providerId: id,
        enterpriseUrl: body.enterprise_url,
      }),
    };
  }

  @Post(':id/oauth/submit-code')
  @RequirePermission('agents:manage')
  @ApiOperation({
    summary:
      'Submit a pasted authorization code/redirect URL for an OAuth login',
  })
  async submitOAuthCode(
    @Param('id') _id: string,
    @ZodBody(SubmitOAuthCodeRequestSchema) body: SubmitOAuthCodeRequest,
  ) {
    await this.oauthLink.submitCode(body.session_id, body.code);
    return { success: true, data: { accepted: true } };
  }

  @Get(':id/oauth/session/:sessionId')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Check status of a pending OAuth login session' })
  oauthSessionStatus(
    @Param('id') _id: string,
    @Param('sessionId') sessionId: string,
  ) {
    return {
      success: true,
      data: this.oauthLink.sessionStatus(sessionId),
    };
  }

  @Get(':id')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get LLM provider by ID' })
  async getProvider(@Param('id') id: string) {
    return { success: true, data: await this.aiConfigAdmin.getProvider(id) };
  }

  @Post()
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Create LLM provider' })
  async createProvider(@ZodBody(CreateProviderSchema) dto: unknown) {
    return {
      success: true,
      data: await this.aiConfigAdmin.createProvider(
        dto as CreateProviderRequest,
      ),
    };
  }

  @Patch(':id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Update LLM provider' })
  async updateProvider(
    @Param('id') id: string,
    @ZodBody(UpdateProviderSchema) dto: unknown,
  ) {
    return {
      success: true,
      data: await this.aiConfigAdmin.updateProvider(
        id,
        dto as UpdateProviderRequest,
      ),
    };
  }

  @Delete(':id')
  @RequirePermission('agents:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete LLM provider' })
  async deleteProvider(@Param('id') id: string) {
    await this.aiConfigAdmin.deleteProvider(id);
  }
}
