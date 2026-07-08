import { Controller, Get, Put, Param, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/authorization/permissions.guard.js';
import { RequirePermission } from '../auth/authorization/require-permission.decorator.js';
import { ScopedAiDefaultService } from './scoped-ai-default.service.js';
import type { ScopedAiDefaultPatch } from './scoped-ai-default.types.js';

@ApiTags('harness')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('harness')
export class HarnessScopedDefaultsController {
  constructor(private readonly svc: ScopedAiDefaultService) {}

  @Get('scoped-defaults')
  @RequirePermission('settings:read')
  getPlatform() {
    return this.svc.getForScope(null);
  }

  @Get('scoped-defaults/:scopeNodeId')
  @RequirePermission('settings:read')
  getForScope(@Param('scopeNodeId') scopeNodeId: string) {
    return this.svc.getForScope(scopeNodeId);
  }

  @Put('scoped-defaults/:scopeNodeId')
  @RequirePermission('settings:manage')
  setForScope(
    @Param('scopeNodeId') scopeNodeId: string,
    @Body() body: ScopedAiDefaultPatch,
  ) {
    return this.svc.setForScope(scopeNodeId, body);
  }
}
