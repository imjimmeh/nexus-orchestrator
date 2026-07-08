import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ProviderOAuthService } from '../services/provider-oauth.service';
import {
  authorizeProviderOAuthSchema,
  completeProviderOAuthCallbackSchema,
} from '../dto/provider-oauth.dto';
import type {
  AuthorizeProviderOAuthInput,
  CompleteProviderOAuthCallbackInput,
} from '../dto/provider-oauth.dto.types';

@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai-config/providers')
export class ProviderOAuthController {
  constructor(private readonly providerOAuthService: ProviderOAuthService) {}

  @Post(':id/oauth/authorize')
  @RequirePermission('agents:manage')
  async authorize(
    @Param('id') id: string,
    @ZodBody(authorizeProviderOAuthSchema)
    dto: AuthorizeProviderOAuthInput,
  ) {
    const result = await this.providerOAuthService.createAuthorizationUrl({
      providerId: id,
      redirectUri: dto.redirect_uri,
    });
    return { success: true, data: result };
  }

  @Post('oauth/callback')
  @RequirePermission('agents:manage')
  @HttpCode(HttpStatus.OK)
  async callback(
    @ZodBody(completeProviderOAuthCallbackSchema)
    dto: CompleteProviderOAuthCallbackInput,
  ) {
    const result = await this.providerOAuthService.completeCallback({
      code: dto.code,
      state: dto.state,
    });
    return { success: true, data: result };
  }

  @Get(':id/oauth/status')
  @RequirePermission('agents:read')
  async status(@Param('id') id: string) {
    const result = await this.providerOAuthService.getStatus(id);
    return { success: true, data: result };
  }
}
