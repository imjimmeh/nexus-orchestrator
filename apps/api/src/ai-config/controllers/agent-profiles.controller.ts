import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import {
  AssignProfileSkillsSchema,
  CreateAgentProfileSchema,
  UpdateAgentProfileSchema,
} from '@nexus/core';
import type {
  AssignProfileSkillsRequest,
  CreateAgentProfileRequest,
  UpdateAgentProfileRequest,
} from '@nexus/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ScopeAccessService } from '../../auth/authorization/scope-access.service';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { AiConfigAdminService } from '../ai-config-admin.service';
import { AgentProfileResolutionService } from '../services/agent-profile-resolution.service';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}

@ApiTags('ai-config-profiles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai-config/agent-profiles')
export class AgentProfilesController {
  constructor(
    private readonly aiConfigAdmin: AiConfigAdminService,
    private readonly profileResolution: AgentProfileResolutionService,
    private readonly scopeAccess: ScopeAccessService,
  ) {}

  @Get()
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List agent profiles' })
  async listAgentProfiles(
    @Query('scopeNodeId') scopeNodeId: string | undefined,
    @Req() req: AuthenticatedRequest,
  ) {
    const scopeIds = await this.scopeAccess.restrictToAccessibleScopes(
      req.user.userId,
      'agents:read',
      scopeNodeId,
    );
    return {
      success: true,
      data: await this.aiConfigAdmin.listAgentProfiles(scopeIds),
    };
  }

  @Get(':id')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get agent profile by ID' })
  async getAgentProfile(@Param('id') id: string) {
    return {
      success: true,
      data: await this.aiConfigAdmin.getAgentProfile(id),
    };
  }

  @Post()
  @RequirePermission('agents:create')
  @ApiOperation({ summary: 'Create agent profile' })
  async createAgentProfile(@ZodBody(CreateAgentProfileSchema) dto: unknown) {
    return {
      success: true,
      data: await this.aiConfigAdmin.createAgentProfile(
        dto as CreateAgentProfileRequest,
      ),
    };
  }

  @Patch(':id')
  @RequirePermission('agents:update')
  @ApiOperation({ summary: 'Update agent profile' })
  async updateAgentProfile(
    @Param('id') id: string,
    @ZodBody(UpdateAgentProfileSchema) dto: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.aiConfigAdmin.updateAgentProfile(
        id,
        dto as UpdateAgentProfileRequest,
        req.user.userId,
      ),
    };
  }

  @Delete(':id')
  @RequirePermission('agents:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete agent profile' })
  async deleteAgentProfile(
    @Param('id') id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.aiConfigAdmin.deleteAgentProfile(id, req.user.userId);
  }

  @Get(':id/skills')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List assigned skills for an agent profile' })
  async listProfileSkills(@Param('id') id: string) {
    return {
      success: true,
      data: await this.aiConfigAdmin.getSkillsForAgentProfile(id),
    };
  }

  @Put(':id/skills')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Replace assigned skills for an agent profile' })
  async replaceProfileSkills(
    @Param('id') id: string,
    @ZodBody(AssignProfileSkillsSchema) dto: unknown,
  ) {
    const request = dto as AssignProfileSkillsRequest;
    return {
      success: true,
      data: await this.aiConfigAdmin.replaceSkillsForAgentProfile(
        id,
        request.skill_ids,
      ),
    };
  }

  @Post(':id/skills/add')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Add assigned skills to an agent profile' })
  async addProfileSkills(
    @Param('id') id: string,
    @ZodBody(AssignProfileSkillsSchema) dto: unknown,
  ) {
    const request = dto as AssignProfileSkillsRequest;
    return {
      success: true,
      data: await this.aiConfigAdmin.addSkillsForAgentProfile(
        id,
        request.skill_ids,
      ),
    };
  }

  @Post(':id/skills/remove')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Remove assigned skills from an agent profile' })
  async removeProfileSkills(
    @Param('id') id: string,
    @ZodBody(AssignProfileSkillsSchema) dto: unknown,
  ) {
    const request = dto as AssignProfileSkillsRequest;
    return {
      success: true,
      data: await this.aiConfigAdmin.removeSkillsForAgentProfile(
        id,
        request.skill_ids,
      ),
    };
  }

  @Get('resolve/:name')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get effective agent profile for a scope' })
  async resolveAgentProfile(
    @Param('name') name: string,
    @Query('scopeNodeId') scopeNodeId?: string,
  ) {
    return {
      success: true,
      data: await this.profileResolution.resolve(name, scopeNodeId ?? null),
    };
  }

  @Post(':id/scopes/:scopeNodeId/override')
  @RequirePermission('agents:create')
  @ApiOperation({ summary: 'Fork agent profile for a specific scope' })
  async forkAgentForScope(
    @Param('id') baseProfileId: string,
    @Param('scopeNodeId') scopeNodeId: string,
    @ZodBody(UpdateAgentProfileSchema) dto: unknown,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.aiConfigAdmin.createScopedAgentOverride(
        baseProfileId,
        scopeNodeId,
        dto as UpdateAgentProfileRequest,
        req.user.userId,
      ),
    };
  }
}
