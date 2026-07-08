import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import type { AuthenticatedRequest } from './workflow-runtime-tools.controller.types';
import { WorkflowRuntimeCapabilityLifecycleService } from './workflow-runtime-capability-lifecycle.service';
import type {
  AddProfileSkillsParams,
  CreateSkillParams,
  CreateToolCandidateParams,
  DeleteSkillFileParams,
  RemoveProfileSkillsParams,
  ReplaceProfileSkillsParams,
  RuntimeContextInput,
  SaveScriptAsSkillParams,
  UpdateSkillParams,
  UpsertSkillFileParams,
  UpsertToolParams,
} from './workflow-runtime-capability-lifecycle.types';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-runtime/capability-lifecycle`
 *   (governed lifecycle actions for tools, skills, and profile skill
 *   assignments executed from workflow runtime traffic).
 * Source role set: agent runtime surface that previously accepted
 *   `Admin` / `Developer` / `Agent`; the lifecycle actions here map
 *   to the developer-class `*:manage` permissions (tool
 *   creation/publishing, skill authoring, profile-skill assignment
 *   governance).
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - createToolCandidate      Admin / Developer / Agent -> agents:manage
 *   - validateToolCandidate    Admin / Developer / Agent -> agents:manage
 *   - publishToolCandidate     Admin / Developer / Agent -> agents:manage
 *   - upsertTool               Admin / Developer / Agent -> agents:manage
 *   - createSkill              Admin / Developer / Agent -> skills:manage
 *   - saveScriptAsSkill        Admin / Developer / Agent -> skills:manage
 *   - updateSkill              Admin / Developer / Agent -> skills:manage
 *   - listSkillFiles           Admin / Developer / Agent -> skills:read
 *   - upsertSkillFile          Admin / Developer / Agent -> skills:manage
 *   - deleteSkillFile          Admin / Developer / Agent -> skills:manage
 *   - replaceProfileSkills     Admin / Developer / Agent -> agents:manage
 *   - addProfileSkills         Admin / Developer / Agent -> agents:manage
 *   - removeProfileSkills      Admin / Developer / Agent -> agents:manage
 *
 * Notes:
 *   - This is a LIFECYCLE controller -- all handlers execute governed
 *     mutations against tool registry, skill library, and agent
 *     profile state. Per the migration policy, every handler maps to
 *     the developer-class `*:manage` permission for its resource.
 *   - Tools live in the agent capability surface (they extend what
 *     agents can invoke), so they map to `agents:manage`. The skill
 *     library is the primary resource for skill CRUD, so skill
 *     handlers map to `skills:manage`. Profile-skill assignment is a
 *     state mutation on agent profiles, so it maps to `agents:manage`.
 *   - `listSkillFiles` is the only read-only handler (a non-mutating
 *     inventory query) and maps to `skills:read`.
 */

type RuntimeCapabilityContextBody = Pick<
  RuntimeContextInput,
  'workflow_run_id' | 'job_id'
>;
type CreateToolCandidateBody = Omit<CreateToolCandidateParams, 'user'>;
type UpsertToolBody = Omit<UpsertToolParams, 'user'>;
type CreateSkillBody = Omit<CreateSkillParams, 'user'>;
type UpdateSkillBody = Omit<UpdateSkillParams, 'skill_id' | 'user'>;
type UpsertSkillFileBody = Omit<UpsertSkillFileParams, 'skill_id' | 'user'>;
type DeleteSkillFileBody = Omit<DeleteSkillFileParams, 'skill_id' | 'user'>;
type ReplaceProfileSkillsBody = Omit<
  ReplaceProfileSkillsParams,
  'profile_id' | 'user'
>;
type AddProfileSkillsBody = Omit<AddProfileSkillsParams, 'profile_id' | 'user'>;
type RemoveProfileSkillsBody = Omit<
  RemoveProfileSkillsParams,
  'profile_id' | 'user'
>;
type SaveScriptAsSkillBody = Omit<SaveScriptAsSkillParams, 'user'>;

@ApiTags('workflow-runtime-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime')
export class WorkflowRuntimeCapabilityLifecycleController {
  constructor(
    private readonly lifecycleTools: WorkflowRuntimeCapabilityLifecycleService,
  ) {}

  private getRuntimeUser(
    req: AuthenticatedRequest,
  ): RuntimeContextInput['user'] {
    return req.user
      ? {
          userId: req.user.userId,
          roles: req.user.roles,
          agentProfileName: req.user.agentProfileName,
        }
      : undefined;
  }

  @Post('tools/candidates')
  @RequirePermission('agents:manage')
  @ApiOperation({
    summary:
      'Create a tool candidate draft through workflow-runtime governance.',
  })
  async createToolCandidate(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateToolCandidateBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.createToolCandidate({
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('tools/candidates/:artifactId/validate')
  @RequirePermission('agents:manage')
  @ApiOperation({
    summary:
      'Validate a tool candidate through workflow-runtime governance checks.',
  })
  async validateToolCandidate(
    @Req() req: AuthenticatedRequest,
    @Param('artifactId') artifactId: string,
    @Body() body: RuntimeCapabilityContextBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.validateToolCandidate({
      artifact_id: artifactId,
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('tools/candidates/:artifactId/publish')
  @RequirePermission('agents:manage')
  @ApiOperation({
    summary:
      'Publish a tool candidate through workflow-runtime governance checks.',
  })
  async publishToolCandidate(
    @Req() req: AuthenticatedRequest,
    @Param('artifactId') artifactId: string,
    @Body() body: RuntimeCapabilityContextBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.publishToolCandidate({
      artifact_id: artifactId,
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('tools/upsert')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Upsert tool registry entry via workflow-runtime.' })
  async upsertTool(
    @Req() req: AuthenticatedRequest,
    @Body() body: UpsertToolBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.upsertTool({
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('skills')
  @RequirePermission('skills:manage')
  @ApiOperation({ summary: 'Create skill via workflow-runtime governance.' })
  async createSkill(
    @Req() req: AuthenticatedRequest,
    @Body() body: CreateSkillBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.createSkill({
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('skills/save-script')
  @RequirePermission('skills:manage')
  @ApiOperation({
    summary:
      'Persist script content as a reusable skill and optional profile assignment.',
  })
  async saveScriptAsSkill(
    @Req() req: AuthenticatedRequest,
    @Body() body: SaveScriptAsSkillBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.saveScriptAsSkill({
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Patch('skills/:skillId')
  @RequirePermission('skills:manage')
  @ApiOperation({ summary: 'Update skill via workflow-runtime governance.' })
  async updateSkill(
    @Req() req: AuthenticatedRequest,
    @Param('skillId') skillId: string,
    @Body() body: UpdateSkillBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.updateSkill({
      skill_id: skillId,
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('skills/:skillId/files/list')
  @RequirePermission('skills:read')
  @ApiOperation({ summary: 'List skill files via workflow-runtime.' })
  async listSkillFiles(
    @Req() req: AuthenticatedRequest,
    @Param('skillId') skillId: string,
    @Body() body: RuntimeCapabilityContextBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.listSkillFiles({
      skill_id: skillId,
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Put('skills/:skillId/files')
  @RequirePermission('skills:manage')
  @ApiOperation({
    summary: 'Create or update skill file via workflow-runtime.',
  })
  async upsertSkillFile(
    @Req() req: AuthenticatedRequest,
    @Param('skillId') skillId: string,
    @Body() body: UpsertSkillFileBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.upsertSkillFile({
      skill_id: skillId,
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Delete('skills/:skillId/files')
  @RequirePermission('skills:manage')
  @ApiOperation({ summary: 'Delete skill file via workflow-runtime.' })
  async deleteSkillFile(
    @Req() req: AuthenticatedRequest,
    @Param('skillId') skillId: string,
    @Body() body: DeleteSkillFileBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.deleteSkillFile({
      skill_id: skillId,
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Put('profiles/:profileId/skills')
  @RequirePermission('agents:manage')
  @ApiOperation({
    summary:
      'Replace profile skill assignments via workflow-runtime governance.',
  })
  async replaceProfileSkills(
    @Req() req: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Body() body: ReplaceProfileSkillsBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.replaceProfileSkills({
      profile_id: profileId,
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('profiles/:profileId/skills/add')
  @RequirePermission('agents:manage')
  @ApiOperation({
    summary: 'Add profile skill assignments via workflow-runtime governance.',
  })
  async addProfileSkills(
    @Req() req: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Body() body: AddProfileSkillsBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.addProfileSkills({
      profile_id: profileId,
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }

  @Post('profiles/:profileId/skills/remove')
  @RequirePermission('agents:manage')
  @ApiOperation({
    summary:
      'Remove profile skill assignments via workflow-runtime governance.',
  })
  async removeProfileSkills(
    @Req() req: AuthenticatedRequest,
    @Param('profileId') profileId: string,
    @Body() body: RemoveProfileSkillsBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.lifecycleTools.removeProfileSkills({
      profile_id: profileId,
      ...body,
      user: this.getRuntimeUser(req),
    });
    return { success: true, data };
  }
}
