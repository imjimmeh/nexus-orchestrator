import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PermissionsGuard } from '../auth/authorization/permissions.guard.js';
import { RequirePermission } from '../auth/authorization/require-permission.decorator.js';
import { HarnessConfigService } from './harness-config.service.js';
import type { CreateHarnessInput } from './harness-config.types.js';

@ApiTags('harness')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('harness')
export class HarnessConfigController {
  constructor(private readonly svc: HarnessConfigService) {}

  @Get()
  @RequirePermission('settings:read')
  list() {
    return this.svc.list();
  }

  @Get(':harnessId')
  @RequirePermission('settings:read')
  detail(@Param('harnessId') id: string) {
    return this.svc.detail(id);
  }

  @Post()
  @RequirePermission('settings:manage')
  create(@Body() body: CreateHarnessInput) {
    return this.svc.create(body);
  }

  @Patch(':harnessId')
  @RequirePermission('settings:manage')
  update(
    @Param('harnessId') id: string,
    @Body() body: Partial<CreateHarnessInput>,
  ) {
    return this.svc.update(id, body);
  }

  @Post(':harnessId/validate')
  @RequirePermission('settings:read')
  validate(
    @Param('harnessId') harnessId: string,
    @Query('scopeNodeId') scopeNodeId?: string,
  ) {
    return this.svc.validate(harnessId, scopeNodeId);
  }

  @Delete(':harnessId')
  @RequirePermission('settings:manage')
  remove(@Param('harnessId') id: string) {
    return this.svc.remove(id);
  }
}
