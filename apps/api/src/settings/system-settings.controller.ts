import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { SystemSettingsService } from './system-settings.service';
import { UpdateSystemSettingDto } from './dto/update-system-setting.dto';

@ApiTags('system-settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('system-settings')
export class SystemSettingsController {
  constructor(private readonly settingsService: SystemSettingsService) {}

  @Get()
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'List all system settings' })
  async findAll() {
    const settings = await this.settingsService.getAll();
    return { success: true, data: settings };
  }

  @Put(':key')
  @RequirePermission('settings:manage')
  @ApiOperation({
    summary:
      'Create or update a system setting. Memory-domain keys (memoryDistillationThreshold*) emit a MemorySettingChanged event for downstream observability.',
  })
  async upsert(
    @Param('key') key: string,
    @Body() dto: UpdateSystemSettingDto,
    @Req() request: Request,
  ) {
    const actorId = readActorId(request);
    const setting = await this.settingsService.setAndEmit(
      key,
      dto.value,
      dto.description,
      actorId,
    );
    return { success: true, data: setting };
  }
}

function readActorId(request: Request): string | undefined {
  const user = (
    request as Request & {
      user?: { id?: string; sub?: string };
    }
  ).user;
  if (!user) {
    return undefined;
  }
  if (typeof user.id === 'string' && user.id.length > 0) {
    return user.id;
  }
  if (typeof user.sub === 'string' && user.sub.length > 0) {
    return user.sub;
  }
  return undefined;
}
