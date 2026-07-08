import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { UpdateTelegramSettingsDto } from './dto/update-telegram-settings.dto';
import { TelegramSettingsService } from './telegram-settings.service';

@ApiTags('telegram-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('system-settings/telegram')
export class TelegramSettingsController {
  constructor(private readonly telegramSettings: TelegramSettingsService) {}

  @Get()
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'Get Telegram settings (secrets masked)' })
  async findSettings() {
    const data = await this.telegramSettings.getSettingsView();
    return { success: true, data };
  }

  @Put()
  @RequirePermission('settings:manage')
  @ApiOperation({ summary: 'Update Telegram settings' })
  async updateSettings(@Body() dto: UpdateTelegramSettingsDto) {
    const data = await this.telegramSettings.updateSettings(dto);
    return { success: true, data };
  }
}
