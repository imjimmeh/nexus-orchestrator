import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  WorkflowRunControlRequestV1Schema,
  WorkflowRunScopeCancelRequestV1Schema,
  WorkflowRunRequestV1Schema,
} from '@nexus/core';
import type {
  WorkflowRunControlRequestV1,
  WorkflowRunScopeCancelRequestV1,
  WorkflowRunRequestV1,
} from '@nexus/core';
import { InternalServiceScopes } from '../auth/internal-service-scopes.decorator';
import { InternalServiceScopeGuard } from '../auth/internal-service-scope.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { WorkflowInternalCoreRunsService } from './workflow-internal-core-runs.service';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-internal-core-runs` (internal-surface
 * controller exposed to the core orchestrator). Source role set:
 * `Admin` / `Developer`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - requestRun      Admin / Developer (write)  -> workflows:create
 *   - getRunStatus    Admin / Developer (read)   -> workflows:read
 *   - cancelScopeRuns Admin / Developer (write)  -> workflows:update
 *   - controlRun      Admin / Developer (write)  -> workflows:update
 *
 * Notes:
 *   - The `InternalServiceScopes` decorator remains in place: this
 *     is an internal-surface controller and the upstream guard
 *     `InternalServiceScopeGuard` continues to enforce that the
 *     caller carries an internal service scope token in addition
 *     to the user permission.
 *   - Read operations (status) map to `workflows:read`; the
 *     write / lifecycle operations (create, cancel, control)
 *     map to `workflows:create` and `workflows:update` per the
 *     standard workflow resource split.
 */

@ApiTags('internal-core-workflow-runs')
@ApiBearerAuth()
@UseGuards(InternalServiceScopeGuard, JwtAuthGuard, PermissionsGuard)
@Controller('internal/core/workflow-runs')
export class WorkflowInternalCoreRunsController {
  constructor(private readonly coreRuns: WorkflowInternalCoreRunsService) {}

  @Post()
  @InternalServiceScopes('core.workflow-runs:write')
  @RequirePermission('workflows:create')
  @ApiOperation({
    summary: 'Submit workflow run request via internal core contract',
  })
  async requestRun(@Body() body: WorkflowRunRequestV1) {
    const request = WorkflowRunRequestV1Schema.parse(body);
    const data = await this.coreRuns.requestWorkflowRun(request);
    return { success: true, data };
  }

  @Get(':runId')
  @InternalServiceScopes('core.workflow-runs:read')
  @RequirePermission('workflows:read')
  @ApiOperation({
    summary: 'Get workflow run status via internal core contract',
  })
  async getRunStatus(@Param('runId') runId: string) {
    const data = await this.coreRuns.getWorkflowRunStatus(runId);
    return { success: true, data };
  }

  @Post('scope/:scopeId/cancel')
  @InternalServiceScopes('core.workflow-runs:write')
  @RequirePermission('workflows:update')
  @ApiOperation({
    summary: 'Cancel all active workflow runs for a scope',
  })
  async cancelScopeRuns(
    @Param('scopeId') scopeId: string,
    @Body() body: WorkflowRunScopeCancelRequestV1,
  ) {
    const request = WorkflowRunScopeCancelRequestV1Schema.parse(body);
    const data = await this.coreRuns.cancelWorkflowRunsByScope(
      scopeId,
      request,
    );
    return { success: true, data };
  }

  @Post(':runId/control')
  @InternalServiceScopes('core.workflow-runs:write')
  @RequirePermission('workflows:update')
  @ApiOperation({
    summary: 'Control workflow run via internal core contract',
  })
  async controlRun(
    @Param('runId') runId: string,
    @Body() body: WorkflowRunControlRequestV1,
  ) {
    const request = WorkflowRunControlRequestV1Schema.parse(body);
    const data = await this.coreRuns.controlWorkflowRun(runId, request);
    return { success: true, data };
  }
}
