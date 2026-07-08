import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';
import { RequirePermission } from './require-permission.decorator';
import { EnforcementModeService } from './enforcement-mode.service';
import { SystemSettingsService } from '../../settings/system-settings.service';
import { RESOURCES } from './permission-catalog';
import { ENFORCEMENT_MODES, enforcementModeKey } from './enforcement-mode';
import type { EnforcementMode } from './enforcement-mode.types';

interface SetModeBody {
  mode: EnforcementMode;
}

@Controller('authz/enforcement-mode')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermission('settings:manage')
export class EnforcementModeController {
  constructor(
    private readonly enforcement: EnforcementModeService,
    private readonly settings: SystemSettingsService,
  ) {}

  @Get()
  async list(): Promise<{ modes: Record<string, EnforcementMode> }> {
    const entries = await Promise.all(
      RESOURCES.map(
        async (r) => [r, await this.enforcement.getMode(r)] as const,
      ),
    );
    return { modes: Object.fromEntries(entries) };
  }

  @Put(':resource')
  async setMode(
    @Param('resource') resource: string,
    @Body() body: SetModeBody,
  ): Promise<{ resource: string; mode: EnforcementMode }> {
    if (!(ENFORCEMENT_MODES as readonly string[]).includes(body.mode)) {
      throw new BadRequestException(
        `Invalid enforcement mode '${body.mode}'. Allowed: ${ENFORCEMENT_MODES.join(', ')}.`,
      );
    }
    const key = enforcementModeKey(resource);
    await this.settings.set(
      key,
      body.mode,
      `RBAC enforcement mode for the '${resource}' resource.`,
    );
    return { resource, mode: body.mode };
  }
}
