import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import type { ToolCallApprovalRequest } from '../tool/database/entities/tool-call-approval-request.entity';
import type { ArgumentPattern } from '../tool/database/entities/tool-approval-rule.entity';
import { ToolCallApprovalRequestRepository } from '../tool/database/repositories/tool-call-approval-request.repository';
import { ToolApprovalRuleService } from './tool-approval-rule.service';
import { ToolCallApprovalRequestService } from './tool-call-approval-request.service';

class ApproveToolCallDto {
  alwaysAllowExact?: boolean;
  alwaysAllowSimilar?: boolean;
  allowThisSession?: boolean;
  similarPatterns?: Array<{
    path: string;
    operator: 'eq' | 'contains' | 'regex' | 'glob';
    value: string;
  }>;
}

class RejectToolCallDto {
  reason?: string;
}

interface AuthenticatedRequest extends Request {
  user?: {
    userId?: string;
    roles?: string[];
    agentProfileName?: string;
  };
}

@Controller('tool-call-approval-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ToolCallApprovalRequestsController {
  constructor(
    private readonly approvalService: ToolCallApprovalRequestService,
    private readonly ruleService: ToolApprovalRuleService,
    private readonly requestRepo: ToolCallApprovalRequestRepository,
  ) {}

  @Get('pending')
  @RequirePermission('approvals:read')
  async listPending(
    @Query('scopeId') scopeId?: string,
    @Query('workflowRunId') workflowRunId?: string,
  ) {
    if (workflowRunId) {
      return this.requestRepo.findPendingByWorkflowRun(workflowRunId);
    }
    if (scopeId) {
      return this.requestRepo.findPendingByScopeId(scopeId);
    }
    return this.requestRepo.find({
      where: { status: 'pending' },
      order: { createdAt: 'DESC' },
    });
  }

  @Post(':id/approve')
  @RequirePermission('approvals:update')
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveToolCallDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = this.resolveAuthenticatedUserId(req);
    const request = await this.loadRequestOrThrow(id);
    this.assertSimilarPatternsSafety(dto);
    const resolutionRuleId = await this.resolveResolutionRuleId({
      dto,
      request,
      userId,
    });

    await this.approvalService.approveRequest(id, userId, resolutionRuleId);
    return { ok: true };
  }

  @Post(':id/reject')
  @RequirePermission('approvals:update')
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectToolCallDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const userId = this.resolveAuthenticatedUserId(req);

    await this.approvalService.rejectRequest(id, userId, dto.reason);
    return { ok: true };
  }

  private resolveAuthenticatedUserId(req: AuthenticatedRequest): string {
    const userId = req.user?.userId;
    if (!userId) {
      throw new UnauthorizedException();
    }
    return userId;
  }

  private async loadRequestOrThrow(
    id: string,
  ): Promise<ToolCallApprovalRequest> {
    const request = await this.requestRepo.findOne({ where: { id } });
    if (!request) {
      throw new NotFoundException(`Request ${id} not found`);
    }
    return request;
  }

  private assertSimilarPatternsSafety(dto: ApproveToolCallDto): void {
    if (
      dto.alwaysAllowSimilar &&
      (!dto.similarPatterns || dto.similarPatterns.length === 0)
    ) {
      throw new BadRequestException(
        'alwaysAllowSimilar requires non-empty similarPatterns',
      );
    }
  }

  private async resolveResolutionRuleId(params: {
    dto: ApproveToolCallDto;
    request: ToolCallApprovalRequest;
    userId: string;
  }): Promise<string | undefined> {
    if (
      !params.dto.alwaysAllowExact &&
      !params.dto.alwaysAllowSimilar &&
      !params.dto.allowThisSession
    ) {
      return undefined;
    }

    const scopeType = params.dto.allowThisSession ? 'workflow_run' : 'project';
    const context = {
      scopeId: params.request.scopeId ?? undefined,
      workflowRunId: params.request.workflowRunId ?? undefined,
      agentProfile: params.request.requestedBy ?? undefined,
    };

    const argumentPatterns = this.buildArgumentPatterns(
      params.request,
      params.dto,
    );

    const rule = await this.ruleService.createRuleFromApproval({
      context,
      toolName: params.request.toolName,
      argumentPatterns,
      effect: 'allow',
      createdBy: `user:${params.userId}`,
      scopeType,
    });

    return rule.id;
  }

  private buildArgumentPatterns(
    request: ToolCallApprovalRequest,
    dto: ApproveToolCallDto,
  ): ArgumentPattern[] {
    if (!dto.alwaysAllowExact) {
      return dto.similarPatterns ?? [];
    }

    return Object.entries(request.toolArguments).map(([path, value]) => ({
      path,
      operator: 'eq' as const,
      value: String(value),
    }));
  }
}
