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
  CheckAgentMentionsSchema,
  InviteAgentToChatSchema,
  MentionAgentSchema,
  ResolveAgentThreadSchema,
} from '@nexus/core';
import type { z } from 'zod';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ChatSessionCollaborationClient } from '../../telemetry/chat-session-collaboration.client';
import { AgentCommunicationMeshService } from '../workflow-subagents/agent-communication-mesh.service';
import type { AuthenticatedRequest } from './workflow-runtime-tools.controller.types';
import { parseAgentExecutionContext } from './workflow-runtime-tools.context';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-runtime/agent-mentions` (agent runtime
 * traffic).
 * Source role set: `Admin` / `Developer` / `Agent`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - mentionAgent         Admin / Developer / Agent -> agents:update
 *   - checkMentions        Admin / Developer / Agent -> agents:read
 *   - resolveThread        Admin / Developer / Agent -> agents:update
 *   - inviteToChat         Admin / Developer / Agent -> agents:update
 *
 * Notes:
 *   - All four handlers mutate the agent-communication-mesh or
 *     chat-collaboration state for a target agent profile, which
 *     maps cleanly to the agent's documented `agents:read` /
 *     `agents:update` permission set.
 */

type MentionAgentBody = Omit<z.infer<typeof MentionAgentSchema>, 'action'>;
type CheckAgentMentionsBody = Omit<
  z.infer<typeof CheckAgentMentionsSchema>,
  'action'
>;
type ResolveAgentThreadBody = Omit<
  z.infer<typeof ResolveAgentThreadSchema>,
  'action'
>;
type InviteAgentToChatBody = Omit<
  z.infer<typeof InviteAgentToChatSchema>,
  'action'
> & { chat_session_id?: string };

@ApiTags('workflow-runtime-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime/agent-mentions')
export class WorkflowRuntimeAgentMentionsController {
  constructor(
    private readonly meshService: AgentCommunicationMeshService,
    private readonly chatCollaboration: ChatSessionCollaborationClient,
  ) {}

  @ApiOperation({
    summary: 'Mention another agent in the current workflow run.',
  })
  @Post('mention')
  @RequirePermission('agents:update')
  async mentionAgent(
    @Req() req: AuthenticatedRequest,
    @Body() body: MentionAgentBody,
  ) {
    const result = await this.meshService.mentionAgent({
      workflow_run_id: this.requireWorkflowRunId(req),
      requester_execution_id: req.user?.stepId,
      target_agent_profile: body.target_agent_profile,
      message: body.message,
      context_id: body.context_id,
      urgency: body.urgency,
      thread_id: body.thread_id,
      correlation_id: body.correlation_id,
      metadata: {
        ...(body.context_files ? { context_files: body.context_files } : {}),
      },
    });
    return { success: true, data: result };
  }

  @ApiOperation({ summary: 'Check mention threads for this agent.' })
  @Post('check')
  @RequirePermission('agents:read')
  async checkMentions(
    @Req() req: AuthenticatedRequest,
    @Body() body: CheckAgentMentionsBody,
  ) {
    const result = await this.meshService.checkAgentMentions({
      workflow_run_id: this.requireWorkflowRunId(req),
      requester_execution_id: req.user?.stepId,
      thread_id: body.thread_id,
    });
    return { success: true, data: result };
  }

  @ApiOperation({ summary: 'Resolve an agent mention thread.' })
  @Post('resolve')
  @RequirePermission('agents:update')
  async resolveThread(
    @Req() req: AuthenticatedRequest,
    @Body() body: ResolveAgentThreadBody,
  ) {
    const result = await this.meshService.resolveAgentThread({
      workflow_run_id: this.requireWorkflowRunId(req),
      requester_execution_id: req.user?.stepId,
      resolver_execution_id: req.user?.stepId,
      thread_id: body.thread_id,
      resolution_note: body.resolution_note,
    });
    return { success: true, data: result };
  }

  @ApiOperation({
    summary: 'Invite another agent to the current chat session.',
  })
  @Post('invite-to-chat')
  @RequirePermission('agents:update')
  async inviteToChat(
    @Req() req: AuthenticatedRequest,
    @Body() body: InviteAgentToChatBody,
  ) {
    const chatSessionId = body.chat_session_id?.trim();
    if (!chatSessionId) {
      throw new BadRequestException('Chat session agent context is required');
    }
    const result = await this.chatCollaboration.inviteParticipant({
      chatSessionId,
      targetAgentProfile: body.target_agent_profile,
      role: body.chat_role,
      invitedBy: req.user?.stepId,
      metadata: { reason: body.reason },
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
}
