import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { parseAgentExecutionContext } from '../workflow-runtime/workflow-runtime-tools.context';
import type { AuthenticatedRequest } from '../workflow-runtime/workflow-runtime-tools.controller.types';
import { WorkflowDelegationToolProjectionService } from './workflow-delegation-tool-projection.service';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-delegation-tools` (agent runtime
 * traffic that projects delegation tool invocations to subagent
 * workflow runs). Source role set: `Admin` / `Developer` / `Agent`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - invokeProjectedDelegation  Admin / Developer / Agent -> agents:create
 *
 * Notes:
 *   - The handler instantiates a new subagent workflow delegation
 *     (it dispatches a projected delegation tool that spawns a
 *     child workflow run), so the migration maps it to
 *     `agents:create`, matching the documented permission set
 *     for subagent delegation contract creation in
 *     `workflow-runtime-subagents.controller.ts`.
 */

@ApiTags('workflow-delegation-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime/orchestration/projected-workflow-delegations')
export class WorkflowDelegationToolsController {
  constructor(
    private readonly projections: WorkflowDelegationToolProjectionService,
  ) {}

  @Post(':toolName/invoke')
  @RequirePermission('agents:create')
  async invokeProjectedDelegation(
    @Param('toolName') toolName: string,
    @Req() req: AuthenticatedRequest,
    @Body() body: Record<string, unknown> = {},
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const agentContext = parseAgentExecutionContext(req.user?.userId);
    const workflowRunId =
      agentContext?.workflowRunId ?? req.user?.workflowRunId;
    const data = await this.projections.invokeProjectedDelegation(
      toolName,
      body,
      workflowRunId,
      req.user?.stepId,
    );
    return { success: true, data };
  }
}
