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
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ListScheduledJobRunsDto } from './dto/list-scheduled-job-runs.dto';
import { ListScheduledJobsDto } from './dto/list-scheduled-jobs.dto';
import { ScheduledJobsService } from './scheduled-jobs.service';
import {
  createScheduledJobSchema,
  updateScheduledJobSchema,
} from '@nexus/core';
import type {
  CreateScheduledJobRequest,
  UpdateScheduledJobRequest,
} from '@nexus/core';

const CREATE_PIPE = new ZodValidationPipe(createScheduledJobSchema);
const UPDATE_PIPE = new ZodValidationPipe(updateScheduledJobSchema);

@ApiTags('automation-schedules')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('automation/schedules')
export class ScheduledJobsController {
  constructor(private readonly scheduledJobsService: ScheduledJobsService) {}

  @Post()
  @RequirePermission('workflows:create')
  @ApiOperation({ summary: 'Create a scheduled job' })
  async create(@Body(CREATE_PIPE) dto: CreateScheduledJobRequest) {
    const schedule = await this.scheduledJobsService.createScheduledJob(dto);
    return { success: true, data: schedule };
  }

  @Get()
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List scheduled jobs' })
  async list(@Query() query: ListScheduledJobsDto) {
    const data = await this.scheduledJobsService.listScheduledJobs(
      {
        scopeId: query.scopeId,
        scope: query.scope,
        status: query.status,
      },
      {
        limit: query.limit,
        offset: query.offset,
      },
    );

    return { success: true, data };
  }

  @Get(':id')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get scheduled job details' })
  async getById(@Param('id') id: string) {
    const schedule = await this.scheduledJobsService.getScheduledJob(id);
    return { success: true, data: schedule };
  }

  @Patch(':id')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Update a scheduled job' })
  async update(
    @Param('id') id: string,
    @Body(UPDATE_PIPE) dto: UpdateScheduledJobRequest,
  ) {
    const schedule = await this.scheduledJobsService.updateScheduledJob(
      id,
      dto,
    );
    return { success: true, data: schedule };
  }

  @Post(':id/pause')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Pause a scheduled job' })
  async pause(@Param('id') id: string) {
    const schedule = await this.scheduledJobsService.pauseScheduledJob(id);
    return { success: true, data: schedule };
  }

  @Post(':id/resume')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Resume a scheduled job' })
  async resume(@Param('id') id: string) {
    const schedule = await this.scheduledJobsService.resumeScheduledJob(id);
    return { success: true, data: schedule };
  }

  @Post(':id/run-now')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Run a schedule immediately' })
  async runNow(@Param('id') id: string) {
    const run = await this.scheduledJobsService.runScheduledJobNow(id);
    return { success: true, data: run };
  }

  @Delete(':id')
  @RequirePermission('workflows:delete')
  @ApiOperation({ summary: 'Delete a scheduled job' })
  async remove(@Param('id') id: string) {
    await this.scheduledJobsService.deleteScheduledJob(id);
    return { success: true, data: { id } };
  }

  @Get(':id/runs')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List scheduled job run history' })
  async listRuns(
    @Param('id') id: string,
    @Query() query: ListScheduledJobRunsDto,
  ) {
    const data = await this.scheduledJobsService.listScheduledJobRuns(id, {
      limit: query.limit,
      offset: query.offset,
    });
    return { success: true, data };
  }
}
