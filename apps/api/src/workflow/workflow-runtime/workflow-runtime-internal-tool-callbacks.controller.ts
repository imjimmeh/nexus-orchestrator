import { Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  internalToolCallbackBodySchema,
  type InternalToolCallbackBody,
} from '@nexus/core';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import type { AuthenticatedRequest } from './workflow-runtime-tools.controller.types';
import { WorkflowRuntimeToolsService } from './workflow-runtime-tools.service';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-runtime/internal-tool-callbacks`
 *   (internal tool callback bridge used by agent runtime to invoke
 *   search/read-style operations and learning-candidate lifecycle
 *   transitions against the canonical library surfaces).
 * Source role set: agent runtime traffic that previously accepted
 *   `Admin` / `Developer` / `Agent`; the handlers map to the agent's
 *   documented runtime permission set, with `*:manage` used for
 *   lifecycle transitions (promote/reject candidates, materialize
 *   skills).
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - searchWorkflows            Admin / Developer / Agent -> workflows:read
 *   - readWorkflowSummary        Admin / Developer / Agent -> workflows:read
 *   - searchSkills               Admin / Developer / Agent -> skills:read
 *   - readSkillManifest          Admin / Developer / Agent -> skills:read
 *   - searchPlaybooks            Admin / Developer / Agent -> workflows:read
 *   - readPlaybook               Admin / Developer / Agent -> workflows:read
 *   - listPendingCandidates      Admin / Developer / Agent -> skills:read
 *   - promoteCandidate           Admin / Developer / Agent -> skills:manage
 *   - rejectCandidate            Admin / Developer / Agent -> skills:manage
 *   - createSkillProposal        Admin / Developer / Agent -> skills:create
 *   - suggestSkillAssignment     Admin / Developer / Agent -> skills:create
 *   - materializeSkill           Admin / Developer / Agent -> skills:create
 *   - materializeSkillUpdate     Admin / Developer / Agent -> skills:update
 *
 * Notes:
 *   - Search/read-style callbacks map to the corresponding `*:read`
 *     permission for the resource they target (workflows for
 *     playbooks, since playbooks are workflow-shaped artifacts).
 *   - Lifecycle actions on learning candidates (promote/reject) mutate
 *     skill library state, so they require the developer-class
 *     `skills:manage` permission per the migration policy.
 *   - Materialization helpers split into create vs update based on the
 *     underlying library operation (`create_skill` / `update_skill`).
 */

@ApiTags('workflow-runtime-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime')
export class WorkflowRuntimeInternalToolCallbacksController {
  constructor(private readonly runtimeTools: WorkflowRuntimeToolsService) {}

  @ApiOperation({
    summary: 'Search workflows through an internal tool callback.',
  })
  @Post('workflows/search')
  @RequirePermission('workflows:read')
  async searchWorkflows(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'search_workflows', body);
  }

  @ApiOperation({
    summary: 'Read a workflow summary through an internal tool callback.',
  })
  @Post('workflows/read-summary')
  @RequirePermission('workflows:read')
  async readWorkflowSummary(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'read_workflow_summary', body);
  }

  @ApiOperation({ summary: 'Search skills through an internal tool callback.' })
  @Post('skills/search')
  @RequirePermission('skills:read')
  async searchSkills(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'search_skills', body);
  }

  @ApiOperation({
    summary: 'Read a skill manifest through an internal tool callback.',
  })
  @Post('skills/read-manifest')
  @RequirePermission('skills:read')
  async readSkillManifest(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'read_skill_manifest', body);
  }

  @ApiOperation({
    summary: 'Search playbooks through an internal tool callback.',
  })
  @Post('playbooks/search')
  @RequirePermission('workflows:read')
  async searchPlaybooks(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'search_playbooks', body);
  }

  @ApiOperation({
    summary: 'Read a playbook through an internal tool callback.',
  })
  @Post('playbooks/read')
  @RequirePermission('workflows:read')
  async readPlaybook(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'read_playbook', body);
  }

  @ApiOperation({
    summary:
      'List pending learning candidates through an internal tool callback.',
  })
  @Post('learning/candidates/list-pending')
  @RequirePermission('skills:read')
  async listPendingCandidates(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(
      req,
      'list_pending_learning_candidates',
      body,
    );
  }

  @ApiOperation({
    summary: 'Promote a learning candidate through an internal tool callback.',
  })
  @Post('learning/candidates/promote')
  @RequirePermission('skills:manage')
  async promoteCandidate(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(
      req,
      'promote_learning_candidate',
      body,
    );
  }

  @ApiOperation({
    summary: 'Reject a learning candidate through an internal tool callback.',
  })
  @Post('learning/candidates/reject')
  @RequirePermission('skills:manage')
  async rejectCandidate(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(
      req,
      'reject_learning_candidate',
      body,
    );
  }

  @ApiOperation({
    summary: 'Create a skill proposal through an internal tool callback.',
  })
  @Post('learning/proposals/create')
  @RequirePermission('skills:create')
  async createSkillProposal(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'create_skill_proposal', body);
  }

  @ApiOperation({
    summary: 'Suggest a skill assignment through an internal tool callback.',
  })
  @Post('learning/proposals/suggest-assignment')
  @RequirePermission('skills:create')
  async suggestSkillAssignment(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(
      req,
      'suggest_skill_assignment',
      body,
    );
  }

  @ApiOperation({
    summary: 'Materialize a skill through an internal tool callback.',
  })
  @Post('skills/materialize')
  @RequirePermission('skills:create')
  async materializeSkill(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'create_skill', body);
  }

  @ApiOperation({
    summary: 'Update an existing skill through an internal tool callback.',
  })
  @Post('skills/materialize-update')
  @RequirePermission('skills:update')
  async materializeSkillUpdate(
    @Req() req: AuthenticatedRequest,
    @ZodBody(internalToolCallbackBodySchema) body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    return this.executeInternalToolCallback(req, 'update_skill', body);
  }

  private async executeInternalToolCallback(
    req: AuthenticatedRequest,
    name: string,
    body: InternalToolCallbackBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const { workflow_run_id, job_id, ...payload } =
      body as InternalToolCallbackBody & Record<string, unknown>;
    const data = await this.runtimeTools.executeInternalTool({
      name,
      payload,
      workflow_run_id,
      job_id,
      user: req.user,
    });
    return { success: true, data };
  }
}
