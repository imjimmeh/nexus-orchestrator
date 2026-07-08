import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard.js';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator.js';
import { HarnessAssetService } from './harness-asset.service.js';
import type { CreateAssetInput } from './harness-asset.service.js';

/**
 * Exposes author + list endpoints for harness assets.
 *
 * Transport-only: all validation, checksum computation, and persistence
 * logic lives in `HarnessAssetService`.
 */
@ApiTags('harness')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('harness/assets')
export class HarnessAssetController {
  constructor(private readonly assetService: HarnessAssetService) {}

  /**
   * Author and persist a new immutable harness asset.
   *
   * POST /harness/assets
   */
  @Post()
  @RequirePermission('settings:manage')
  create(@Body() body: CreateAssetInput) {
    return this.assetService.createAsset(body);
  }

  /**
   * List assets filtered by scope.
   *
   * GET /harness/assets?scopeNodeId=<id>
   * Omit `scopeNodeId` (or pass empty) to retrieve platform-global assets.
   */
  @Get()
  @RequirePermission('settings:read')
  list(@Query('scopeNodeId') scopeNodeId?: string) {
    return this.assetService.listAssets(scopeNodeId ?? null);
  }
}
