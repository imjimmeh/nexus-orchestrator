import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { WorkflowRuntimeMeshDelegationToolsService } from './workflow-runtime-mesh-delegation-tools.service';
import { WorkflowRuntimeSubagentToolsService } from './workflow-runtime-subagent-tools.service';
import type {
  AuthenticatedRequest,
  CancelDelegationContractBody,
  CreateDelegationContractBody,
  DelegationContractIdentityBody,
  DelegationReplayBody,
  SubagentSpawnAsyncBody,
  SubagentStatusBody,
  SubagentWaitBody,
} from './workflow-runtime-tools.controller.types';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-runtime/subagents`
 *   (agent runtime traffic for subagent lifecycle, mesh delegation
 *   contract CRUD, and supporting dispatch/sweep/replay handlers).
 * Source role set: agent runtime traffic that previously accepted
 *   `Admin` / `Developer` / `Agent`; handlers map to the agent's
 *   documented `agents:read` / `agents:create` / `agents:update`
 *   permission set.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - spawnSubagentAsync          Admin / Developer / Agent -> agents:create
 *   - waitForSubagents            Admin / Developer / Agent -> agents:read
 *   - checkSubagentStatus         Admin / Developer / Agent -> agents:read
 *   - createDelegationContract    Admin / Developer / Agent -> agents:create
 *   - getDelegationContract       Admin / Developer / Agent -> agents:read
 *   - cancelDelegationContract    Admin / Developer / Agent -> agents:update
 *   - dispatchDelegationContracts Admin / Developer / Agent -> agents:update
 *   - sweepDelegationTimeouts     Admin / Developer / Agent -> agents:update
 *   - getDelegationReplay         Admin / Developer / Agent -> agents:read
 *
 * Notes:
 *   - Subagent spawning and mesh delegation contract creation map to
 *     `agents:create` (they instantiate a new agent execution).
 *   - Status checks, waits, and replay (read-only lifecycle views)
 *     map to `agents:read`.
 *   - Lifecycle state transitions (cancel/dispatch/sweep-timeouts)
 *     map to `agents:update`.
 */

@ApiTags('workflow-runtime-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime')
export class WorkflowRuntimeSubagentsController {
  constructor(
    private readonly subagentTools: WorkflowRuntimeSubagentToolsService,
    private readonly meshDelegationTools: WorkflowRuntimeMeshDelegationToolsService,
  ) {}

  @Post('subagents/spawn-async')
  @RequirePermission('agents:create')
  @ApiOperation({ summary: 'Spawn async subagent from runtime context' })
  async spawnSubagentAsync(
    @Req() req: AuthenticatedRequest,
    @Body() body: SubagentSpawnAsyncBody,
  ) {
    const data = await this.subagentTools.spawnSubagentAsync(req.user, body);
    return { success: true, data };
  }

  @Post('subagents/wait')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Wait for subagent execution completion' })
  async waitForSubagents(
    @Req() req: AuthenticatedRequest,
    @Body() body: SubagentWaitBody,
  ) {
    const data = await this.subagentTools.waitForSubagents(req.user, body);
    return { success: true, data };
  }

  @Post('subagents/status')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get subagent execution status' })
  async checkSubagentStatus(
    @Req() req: AuthenticatedRequest,
    @Body() body: SubagentStatusBody,
  ) {
    const data = await this.subagentTools.checkSubagentStatus(
      req.user,
      body.execution_id,
    );
    return { success: true, data };
  }

  @Post('subagents/delegations/create')
  @RequirePermission('agents:create')
  @ApiOperation({
    summary: 'Create mesh delegation contract and schedule work',
  })
  async createDelegationContract(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateDelegationContractBody,
  ) {
    const data = await this.meshDelegationTools.createDelegationContract(
      req.user,
      body,
    );
    return { success: true, data };
  }

  @Post('subagents/delegations/get')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get mesh delegation contract status' })
  async getDelegationContract(
    @Req() req: AuthenticatedRequest,
    @Body() body: DelegationContractIdentityBody,
  ) {
    const data = await this.meshDelegationTools.getDelegationContract(
      req.user,
      body,
    );
    return { success: true, data };
  }

  @Post('subagents/delegations/cancel')
  @RequirePermission('agents:update')
  @ApiOperation({ summary: 'Cancel mesh delegation contract execution' })
  async cancelDelegationContract(
    @Req() req: AuthenticatedRequest,
    @Body() body: CancelDelegationContractBody,
  ) {
    const data = await this.meshDelegationTools.cancelDelegationContract(
      req.user,
      body,
    );
    return { success: true, data };
  }

  @Post('subagents/delegations/dispatch')
  @RequirePermission('agents:update')
  @ApiOperation({ summary: 'Dispatch queued mesh delegation contracts' })
  async dispatchDelegationContracts(@Req() req: AuthenticatedRequest) {
    const data = await this.meshDelegationTools.dispatchDelegationContracts(
      req.user,
    );
    return { success: true, data };
  }

  @Post('subagents/delegations/sweep-timeouts')
  @RequirePermission('agents:update')
  @ApiOperation({ summary: 'Sweep timed-out mesh delegation contracts' })
  async sweepDelegationTimeouts(@Req() req: AuthenticatedRequest) {
    const data = await this.meshDelegationTools.sweepDelegationTimeouts(
      req.user,
    );
    return { success: true, data };
  }

  @Post('subagents/delegations/replay')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Replay mesh delegation lifecycle for current run' })
  async getDelegationReplay(
    @Req() req: AuthenticatedRequest,
    @Body() body: DelegationReplayBody,
  ) {
    const data = await this.meshDelegationTools.getDelegationReplay(
      req.user,
      body,
    );
    return { success: true, data };
  }
}
