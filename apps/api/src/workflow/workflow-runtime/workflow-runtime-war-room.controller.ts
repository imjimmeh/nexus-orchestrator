import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CloseWarRoomSchema,
  GetWarRoomStateSchema,
  InviteWarRoomParticipantSchema,
  OpenWarRoomSchema,
  PostWarRoomMessageSchema,
  SubmitWarRoomSignoffSchema,
  UpdateWarRoomBlackboardSchema,
} from '@nexus/core';
import type { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { WarRoomService } from '../../war-room/war-room.service';
import type { AuthenticatedRequest } from './workflow-runtime-tools.controller.types';
import { parseAgentExecutionContext } from './workflow-runtime-tools.context';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-runtime/war-room` (agent runtime traffic).
 * Source role set: `Admin` / `Developer` / `Agent`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - openWarRoom          Admin / Developer / Agent -> workflows:create
 *   - inviteParticipant    Admin / Developer / Agent -> agents:update
 *   - postMessage          Admin / Developer / Agent -> memory:create
 *   - updateBlackboard     Admin / Developer / Agent -> memory:update
 *   - submitSignoff        Admin / Developer / Agent -> approvals:manage
 *   - getState             Admin / Developer / Agent -> workflows:read
 *   - closeWarRoom         Admin / Developer / Agent -> workflows:update
 *
 * Notes:
 *   - `submitSignoff` is a lifecycle action (records a signoff/approval
 *     decision), so the migration's "Plus any `*:manage` permissions
 *     required for lifecycle handlers" clause applies -- the agent role
 *     lacks `approvals:create`, so the broader `approvals:manage` is
 *     used.
 *   - Other handlers map cleanly to the agent's documented permission
 *     set (workflows/agents/memory read/create/update).
 */

type OpenWarRoomBody = Omit<z.infer<typeof OpenWarRoomSchema>, 'action'>;
type InviteWarRoomParticipantBody = Omit<
  z.infer<typeof InviteWarRoomParticipantSchema>,
  'action'
>;
type PostWarRoomMessageBody = Omit<
  z.infer<typeof PostWarRoomMessageSchema>,
  'action'
>;
type UpdateWarRoomBlackboardBody = Omit<
  z.infer<typeof UpdateWarRoomBlackboardSchema>,
  'action'
>;
type SubmitWarRoomSignoffBody = Omit<
  z.infer<typeof SubmitWarRoomSignoffSchema>,
  'action'
>;
type GetWarRoomStateBody = Omit<
  z.infer<typeof GetWarRoomStateSchema>,
  'action'
>;
type CloseWarRoomBody = Omit<z.infer<typeof CloseWarRoomSchema>, 'action'>;

@ApiTags('workflow-runtime-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime/war-room')
export class WorkflowRuntimeWarRoomController {
  constructor(private readonly warRoomService: WarRoomService) {}

  @ApiOperation({ summary: 'Open a workflow-scoped war-room session.' })
  @Post('open')
  @RequirePermission('workflows:create')
  async openWarRoom(
    @Req() req: AuthenticatedRequest,
    @Body() body: OpenWarRoomBody,
  ) {
    const workflowRunId = this.requireWorkflowRunId(req);
    const moderatorProfile = this.requireAgentProfile(req, 'open_war_room');
    const result = await this.warRoomService.openSession({
      session_id: body.session_id,
      scope_id: body.scope_id,
      context_id: body.context_id,
      workflow_run_id: workflowRunId,
      created_by_execution_id: req.user?.stepId,
      moderator_profile: moderatorProfile,
      participants: body.participants,
      initial_message: body.initial_message,
    });
    return { success: true, data: result };
  }

  @ApiOperation({ summary: 'Invite an agent profile to a war-room session.' })
  @Post('invite-participant')
  @RequirePermission('agents:update')
  async inviteParticipant(
    @Req() req: AuthenticatedRequest,
    @Body() body: InviteWarRoomParticipantBody,
  ) {
    const agentProfile = body.agent_profile ?? body.target_agent_profile;
    if (!agentProfile) {
      throw new BadRequestException('Missing agent_profile');
    }
    const result = await this.warRoomService.inviteParticipant({
      workflow_run_id: this.requireWorkflowRunId(req),
      session_id: body.session_id,
      agent_profile: agentProfile,
      role: body.role,
    });
    return { success: true, data: result };
  }

  @ApiOperation({ summary: 'Post a message to a war-room session.' })
  @Post('post-message')
  @RequirePermission('memory:create')
  async postMessage(
    @Req() req: AuthenticatedRequest,
    @Body() body: PostWarRoomMessageBody,
  ) {
    const result = await this.warRoomService.postMessage({
      workflow_run_id: this.requireWorkflowRunId(req),
      session_id: body.session_id,
      message_kind: body.message_kind,
      body: body.body,
      sender_execution_id: req.user?.stepId,
      sender_profile: this.requireAgentProfile(req, 'post_war_room_message'),
    });
    return { success: true, data: result };
  }

  @ApiOperation({ summary: 'Update a war-room blackboard.' })
  @Post('update-blackboard')
  @RequirePermission('memory:update')
  async updateBlackboard(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpdateWarRoomBlackboardBody,
  ) {
    const result = await this.warRoomService.updateBlackboard({
      workflow_run_id: this.requireWorkflowRunId(req),
      session_id: body.session_id,
      expected_version: body.expected_version,
      strategy_summary: body.strategy_summary,
      risks: body.risks,
      decision_log: body.decision_log,
      implementation_plan_ref: body.implementation_plan_ref,
      updated_by_execution_id: req.user?.stepId,
    });
    return { success: true, data: result };
  }

  @ApiOperation({ summary: 'Submit this agent profile signoff.' })
  @Post('submit-signoff')
  @RequirePermission('approvals:manage')
  async submitSignoff(
    @Req() req: AuthenticatedRequest,
    @Body() body: SubmitWarRoomSignoffBody,
  ) {
    const authenticatedProfile = this.requireAgentProfile(
      req,
      'submit_war_room_signoff',
    );
    if (body.agent_profile && body.agent_profile !== authenticatedProfile) {
      throw new BadRequestException(
        'submit_war_room_signoff: agent_profile must match the authenticated agent profile',
      );
    }
    const result = await this.warRoomService.submitSignoff({
      workflow_run_id: this.requireWorkflowRunId(req),
      session_id: body.session_id,
      role: body.role,
      agent_profile: authenticatedProfile,
      decision: body.decision,
      rationale: body.rationale,
      submitted_by_execution_id: req.user?.stepId,
    });
    return { success: true, data: result };
  }

  @ApiOperation({ summary: 'Read war-room session state.' })
  @Post('state')
  @RequirePermission('workflows:read')
  async getState(
    @Req() req: AuthenticatedRequest,
    @Body() body: GetWarRoomStateBody,
  ) {
    const result = await this.warRoomService.getState({
      workflow_run_id: this.requireWorkflowRunId(req),
      session_id: body.session_id,
    });
    return { success: true, data: result };
  }

  @ApiOperation({ summary: 'Close a war-room session.' })
  @Post('close')
  @RequirePermission('workflows:update')
  async closeWarRoom(
    @Req() req: AuthenticatedRequest,
    @Body() body: CloseWarRoomBody,
  ) {
    const result = await this.warRoomService.closeSession({
      workflow_run_id: this.requireWorkflowRunId(req),
      session_id: body.session_id,
      closed_by_execution_id: req.user?.stepId,
      resolution_type: body.resolution_type,
      resolution_note: body.resolution_note,
    });
    return { success: true, data: result };
  }

  private requireWorkflowRunId(req: AuthenticatedRequest): string {
    const agentContext = parseAgentExecutionContext(req.user?.userId);
    if (!agentContext?.workflowRunId) {
      throw new BadRequestException('Workflow run agent context is required');
    }
    return agentContext.workflowRunId;
  }

  private requireAgentProfile(
    req: AuthenticatedRequest,
    action: string,
  ): string {
    const agentProfile = req.user?.agentProfileName?.trim();
    if (!agentProfile) {
      throw new BadRequestException(
        `${action}: authenticated agent profile is required`,
      );
    }
    return agentProfile;
  }
}
