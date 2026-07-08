import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InternalServiceScopes } from '../auth/internal-service-scopes.decorator';
import { InternalServiceScopeGuard } from '../auth/internal-service-scope.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { TelegramSettingsService } from './telegram-settings.service';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `settings/telegram-settings` (internal surface).
 * Source role set: `Admin` / `Developer`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - getRuntimeSettings  Admin / Developer -> settings:manage
 *
 * Notes:
 *   - Settings is a `manage`-class resource: there is no granular
 *     read/create/update/delete split for Telegram runtime
 *     configuration, so the existing `Admin`/`Developer` role-list
 *     is preserved as a single `settings:manage` permission.
 */

@ApiTags('internal-core-telegram-settings')
@ApiBearerAuth()
@UseGuards(InternalServiceScopeGuard, JwtAuthGuard, PermissionsGuard)
@Controller('internal/core/telegram-settings')
export class TelegramSettingsInternalController {
  constructor(private readonly telegramSettings: TelegramSettingsService) {}

  @Get('runtime')
  @InternalServiceScopes('core.telegram-settings:read')
  @RequirePermission('settings:manage')
  @ApiOperation({
    summary: 'Get runtime Telegram settings including decrypted secrets',
  })
  async getRuntimeSettings() {
    const data = await this.telegramSettings.getRuntimeSettings();
    return { success: true, data };
  }
}
