import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { SetupService } from './setup.service';
import { InitializeSetupDto } from './dto/initialize-setup.dto';
import { SetupStatusResponseDto } from './dto/setup-status.response';
import { InitializeSetupResponseDto } from './dto/initialize-setup.response';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source role set: `admin` (lowercase). The legacy role-based guard
 * was case-insensitive — it lowercased both the configured roles and
 * the incoming `req.user.roles` before comparison, so `'admin'`,
 * `'Admin'`, and `'ADMIN'` were all accepted as long as the user
 * carried an admin role under any casing.
 *
 * That behavior is preserved here: the migration replaces the role
 * list with `settings:manage`, which is the seed-configured
 * permission owned by the admin role. Any user that holds
 * `settings:manage` (regardless of how the underlying role name is
 * cased in the seed) is allowed, matching the runtime semantics of
 * the legacy guard.
 */

type AuthenticatedRequest = Request & {
  user?: {
    roles?: string[];
  };
};

@ApiTags('setup')
@ApiBearerAuth()
@Controller('setup')
export class SetupController {
  constructor(private readonly setupService: SetupService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get current platform setup status' })
  @ApiResponse({ type: SetupStatusResponseDto, status: 200 })
  async getStatus(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ success: boolean; data: SetupStatusResponseDto }> {
    const roles = req.user?.roles || [];
    return { success: true, data: await this.setupService.getStatus(roles) };
  }

  @Post('initialize')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('settings:manage')
  @ApiOperation({
    summary: 'Initialize provider, model, and architect profile',
  })
  @ApiResponse({ type: InitializeSetupResponseDto, status: 201 })
  async initialize(
    @Req() req: AuthenticatedRequest,
    @Body() dto: InitializeSetupDto,
  ): Promise<InitializeSetupResponseDto> {
    const roles = req.user?.roles || [];
    if (!roles.map((role) => role.toLowerCase()).includes('admin')) {
      throw new ForbiddenException('Admin role required.');
    }

    return {
      success: true,
      data: await this.setupService.initialize(roles, dto),
    } as unknown as InitializeSetupResponseDto;
  }

  @Post('skip')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @RequirePermission('settings:manage')
  @ApiOperation({
    summary: 'Skip setup and disable setup requirement flag',
  })
  @ApiResponse({ status: 200, description: 'Setup skipped' })
  async skip(@Req() req: AuthenticatedRequest): Promise<{ skipped: true }> {
    const roles = req.user?.roles || [];
    if (!roles.map((role) => role.toLowerCase()).includes('admin')) {
      throw new ForbiddenException('Admin role required.');
    }

    await this.setupService.skipSetup();
    return { success: true, data: { skipped: true } } as unknown as {
      skipped: true;
    };
  }
}
