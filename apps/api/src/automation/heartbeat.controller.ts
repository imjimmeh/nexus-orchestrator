import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { CreateHeartbeatProfileDto } from './dto/create-heartbeat-profile.dto';
import { ListHeartbeatProfilesDto } from './dto/list-heartbeat-profiles.dto';
import { ListHeartbeatRunsDto } from './dto/list-heartbeat-runs.dto';
import { UpdateHeartbeatProfileDto } from './dto/update-heartbeat-profile.dto';
import { HeartbeatService } from './heartbeat.service';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `automation/heartbeat`. Source role set:
 * `Admin` / `Developer`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - create           Admin / Developer -> automation:manage
 *   - list             Admin / Developer -> automation:read
 *   - getById          Admin / Developer -> automation:read
 *   - update           Admin / Developer -> automation:manage
 *   - runNow           Admin / Developer -> automation:manage
 *   - remove           Admin / Developer -> automation:manage
 *   - listRuns         Admin / Developer -> automation:read
 *
 * Notes:
 *   - Read-only GETs use `automation:read`. Writes and lifecycle
 *     actions (create / update / delete / run-now) use
 *     `automation:manage`. This preserves the existing role-list
 *     while introducing a read-vs-write permission split that
 *     matches the migration's standard policy for the automation
 *     resource.
 */

@ApiTags('automation-heartbeat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('automation/heartbeat')
export class HeartbeatController {
  constructor(private readonly heartbeatService: HeartbeatService) {}

  @Post()
  @RequirePermission('automation:manage')
  @ApiOperation({ summary: 'Create a heartbeat profile' })
  async create(@Body() dto: CreateHeartbeatProfileDto) {
    const data = await this.heartbeatService.createHeartbeatProfile(dto);
    return { success: true, data };
  }

  @Get()
  @RequirePermission('automation:read')
  @ApiOperation({ summary: 'List heartbeat profiles for a project' })
  async list(@Query() query: ListHeartbeatProfilesDto) {
    const data = await this.heartbeatService.listHeartbeatProfiles({
      scopeId: query.scopeId,
      pagination: {
        limit: query.limit,
        offset: query.offset,
      },
    });
    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('automation:read')
  @ApiOperation({ summary: 'Get heartbeat profile details' })
  async getById(@Param('id') id: string) {
    const data = await this.heartbeatService.getHeartbeatProfile(id);
    return { success: true, data };
  }

  @Patch(':id')
  @RequirePermission('automation:manage')
  @ApiOperation({ summary: 'Update a heartbeat profile' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateHeartbeatProfileDto,
  ) {
    const data = await this.heartbeatService.updateHeartbeatProfile(id, dto);
    return { success: true, data };
  }

  @Post(':id/run-now')
  @RequirePermission('automation:manage')
  @ApiOperation({ summary: 'Run heartbeat check immediately' })
  async runNow(@Param('id') id: string) {
    const data = await this.heartbeatService.runHeartbeatNow(id);
    return { success: true, data };
  }

  @Delete(':id')
  @RequirePermission('automation:manage')
  @ApiOperation({ summary: 'Delete heartbeat profile' })
  async remove(@Param('id') id: string) {
    await this.heartbeatService.deleteHeartbeatProfile(id);
    return { success: true, data: { id } };
  }

  @Get(':id/runs')
  @RequirePermission('automation:read')
  @ApiOperation({ summary: 'List heartbeat run history' })
  async listRuns(
    @Param('id') id: string,
    @Query() query: ListHeartbeatRunsDto,
  ) {
    const data = await this.heartbeatService.listHeartbeatRuns(id, {
      limit: query.limit,
      offset: query.offset,
    });
    return { success: true, data };
  }
}
