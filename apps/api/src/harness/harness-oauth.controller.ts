import { Controller, Get, Post, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  StartHarnessOAuthRequestSchema,
  SubmitOAuthCodeRequestSchema,
} from '@nexus/core';
import type {
  HarnessId,
  OAuthSessionStatus,
  OAuthStartResult,
  StartHarnessOAuthRequest,
  SubmitOAuthCodeRequest,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/authorization/permissions.guard.js';
import { RequirePermission } from '../auth/authorization/require-permission.decorator.js';
import { ZodBody } from '../common/decorators/zod-body.decorator.js';
import { HarnessOAuthLinkService } from './harness-oauth-link.service.js';

@ApiTags('harness')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('harness')
export class HarnessOAuthController {
  constructor(private readonly oauthLink: HarnessOAuthLinkService) {}

  @Post(':harnessId/credentials/:key/oauth/start')
  @RequirePermission('settings:manage')
  start(
    @Param('harnessId') harnessId: string,
    @Param('key') key: string,
    @ZodBody(StartHarnessOAuthRequestSchema) body: StartHarnessOAuthRequest,
  ): Promise<OAuthStartResult> {
    return this.oauthLink.start({
      harnessId: harnessId as HarnessId,
      credentialKey: key,
      scopeNodeId: body.scopeNodeId ?? null,
    });
  }

  @Post(':harnessId/credentials/:key/oauth/submit-code')
  @RequirePermission('settings:manage')
  async submitCode(
    @Param('harnessId') _harnessId: string,
    @Param('key') _key: string,
    @ZodBody(SubmitOAuthCodeRequestSchema) body: SubmitOAuthCodeRequest,
  ): Promise<{ accepted: boolean }> {
    await this.oauthLink.submitCode(body.session_id, body.code);
    return { accepted: true };
  }

  @Get(':harnessId/credentials/:key/oauth/session/:sessionId')
  @RequirePermission('settings:read')
  async sessionStatus(
    @Param('harnessId') _harnessId: string,
    @Param('key') _key: string,
    @Param('sessionId') sessionId: string,
  ): Promise<OAuthSessionStatus> {
    return this.oauthLink.sessionStatus(sessionId);
  }
}
