import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import {
  workflowEventLogQuerySchema,
  type WorkflowEventLogQueryRequest,
} from '@nexus/core';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodQuery } from '../common/decorators/zod-query.decorator';
import { WorkflowEventLogService } from './workflow-event-log.service';

type WorkflowEventLogQueryDto = WorkflowEventLogQueryRequest;

@ApiTags('Workflow Events')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runs')
export class WorkflowEventLogController {
  constructor(private readonly eventLogService: WorkflowEventLogService) {}

  @Get(':id/events')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get paginated workflow event history' })
  @ApiResponse({ status: 200, description: 'Paginated workflow events' })
  async getEvents(
    @Param('id', ParseUUIDPipe) workflowRunId: string,
    @ZodQuery(workflowEventLogQuerySchema) query: WorkflowEventLogQueryDto,
  ) {
    const { events, total } = await this.eventLogService.getHistory(
      workflowRunId,
      query.limit,
      query.offset,
    );

    return {
      data: events,
      meta: {
        total,
        limit: query.limit,
        offset: query.offset,
      },
    };
  }

  @Get(':id/audit-summary')
  @RequirePermission('workflows:read')
  @ApiOperation({
    summary: 'Get required-tools audit summary for a workflow run',
  })
  @ApiResponse({
    status: 200,
    description:
      'Run-scoped required-tools audit summary from workflow_run_required_tools_audit_v1',
  })
  async getAuditSummary(@Param('id', ParseUUIDPipe) workflowRunId: string) {
    const summary =
      await this.eventLogService.getRequiredToolsAuditSummary(workflowRunId);

    return {
      data: summary,
    };
  }
}
