import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { DoctorHistoryService } from './doctor-history.service';
import { DoctorRepairExecutorService } from './doctor-repair-executor.service';
import { DoctorReportService } from './doctor-report.service';
import { ExecuteDoctorRepairDto } from './dto/execute-doctor-repair.dto';
import { GetDoctorReportDto } from './dto/get-doctor-report.dto';
import { ListDoctorHistoryDto } from './dto/list-doctor-history.dto';

@ApiTags('operations-doctor')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('operations/doctor')
export class OperationsDoctorController {
  constructor(
    private readonly doctorReportService: DoctorReportService,
    private readonly doctorRepairExecutor: DoctorRepairExecutorService,
    private readonly doctorHistoryService: DoctorHistoryService,
  ) {}

  @Get()
  @RequirePermission('settings:read')
  @ApiOperation({
    summary: 'Generate a consolidated doctor diagnostics report',
  })
  async getDoctorReport(@Query() query: GetDoctorReportDto) {
    const reportEnvelope =
      await this.doctorReportService.generateReportEnvelope();

    if (query.format === 'machine') {
      return {
        success: true,
        data: reportEnvelope.report,
      };
    }

    if (query.format === 'human') {
      return {
        success: true,
        data: {
          summary_markdown: reportEnvelope.summary_markdown,
        },
      };
    }

    return {
      success: true,
      data: reportEnvelope,
    };
  }

  @Post('repair')
  @RequirePermission('settings:manage')
  @ApiOperation({ summary: 'Execute a safe doctor repair action' })
  async executeRepair(
    @Body() dto: ExecuteDoctorRepairDto,
    @Req() req: Request,
  ) {
    if (!dto.dry_run && !dto.confirm) {
      throw new BadRequestException(
        'confirm=true is required for non-dry-run doctor repairs',
      );
    }

    const result = await this.doctorRepairExecutor.execute({
      action_id: dto.action_id,
      dry_run: dto.dry_run,
      requested_by: this.resolveRequestedBy(req, dto.requested_by),
      arguments: dto.arguments ?? {},
    });

    return {
      success: true,
      data: result,
    };
  }

  @Get('history')
  @RequirePermission('settings:read')
  @ApiOperation({ summary: 'List doctor repair execution history' })
  async listHistory(@Query() query: ListDoctorHistoryDto) {
    const data = await this.doctorHistoryService.listHistory({
      limit: query.limit,
      offset: query.offset,
      action_id: query.action_id,
      status: query.status,
    });

    return {
      success: true,
      data,
    };
  }

  private resolveRequestedBy(
    req: Request,
    requestedBy?: string,
  ): string | undefined {
    const explicitRequestedBy = this.normalizeActor(requestedBy);
    if (explicitRequestedBy) {
      return explicitRequestedBy;
    }

    const requestUser = (
      req as Request & {
        user?: {
          sub?: string;
          username?: string;
          email?: string;
          id?: string;
        };
      }
    ).user;

    const candidates = [
      requestUser?.username,
      requestUser?.email,
      requestUser?.sub,
      requestUser?.id,
    ];

    for (const candidate of candidates) {
      const normalized = this.normalizeActor(candidate);
      if (normalized) {
        return normalized;
      }
    }

    return undefined;
  }

  private normalizeActor(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }
}
