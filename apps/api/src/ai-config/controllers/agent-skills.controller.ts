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
  UseGuards,
} from '@nestjs/common';
import {
  AgentSkillsQuerySchema,
  CreateAgentSkillSchema,
  UpdateAgentSkillSchema,
  UpsertSkillFileSchema,
} from '@nexus/core';
import type {
  AgentSkillsQuery,
  CreateAgentSkillRequest,
  UpdateAgentSkillRequest,
  UpsertSkillFileRequest,
} from '@nexus/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { ZodQuery } from '../../common/decorators/zod-query.decorator';
import { AiConfigAdminService } from '../ai-config-admin.service';

@ApiTags('ai-config-skills')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('ai-config/skills')
export class AgentSkillsController {
  constructor(private readonly aiConfigAdmin: AiConfigAdminService) {}

  @Get()
  @RequirePermission('skills:read')
  @ApiOperation({ summary: 'List agent skills' })
  listSkills(@ZodQuery(AgentSkillsQuerySchema) query: unknown) {
    const request = query as AgentSkillsQuery;
    return {
      success: true,
      data: this.aiConfigAdmin.listAgentSkills({
        includeInactive: request.include_inactive,
      }),
    };
  }

  @Get(':id')
  @RequirePermission('skills:read')
  @ApiOperation({ summary: 'Get agent skill by ID' })
  getSkill(@Param('id') id: string) {
    return {
      success: true,
      data: this.aiConfigAdmin.getAgentSkill(id),
    };
  }

  @Post()
  @RequirePermission('skills:create')
  @ApiOperation({ summary: 'Create agent skill' })
  createSkill(@ZodBody(CreateAgentSkillSchema) dto: unknown) {
    return {
      success: true,
      data: this.aiConfigAdmin.createAgentSkill(dto as CreateAgentSkillRequest),
    };
  }

  @Patch(':id')
  @RequirePermission('skills:update')
  @ApiOperation({ summary: 'Update agent skill' })
  updateSkill(
    @Param('id') id: string,
    @ZodBody(UpdateAgentSkillSchema) dto: unknown,
  ) {
    return {
      success: true,
      data: this.aiConfigAdmin.updateAgentSkill(
        id,
        dto as UpdateAgentSkillRequest,
      ),
    };
  }

  @Delete(':id')
  @RequirePermission('skills:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete agent skill' })
  async deleteSkill(@Param('id') id: string) {
    await this.aiConfigAdmin.deleteAgentSkill(id);
  }

  @Get(':id/files')
  @RequirePermission('skills:read')
  @ApiOperation({ summary: 'List files for an agent skill' })
  listSkillFiles(@Param('id') id: string) {
    return {
      success: true,
      data: this.aiConfigAdmin.listAgentSkillFiles(id),
    };
  }

  @Put(':id/files')
  @RequirePermission('skills:manage')
  @ApiOperation({ summary: 'Create or update a file in an agent skill' })
  upsertSkillFile(
    @Param('id') id: string,
    @ZodBody(UpsertSkillFileSchema) dto: unknown,
  ) {
    const request = dto as UpsertSkillFileRequest;
    return {
      success: true,
      data: this.aiConfigAdmin.upsertAgentSkillFile({
        id,
        relativePath: request.relative_path,
        content: request.content ?? '',
        contentBase64: request.content_base64,
      }),
    };
  }

  @Delete(':id/files')
  @RequirePermission('skills:manage')
  @ApiOperation({ summary: 'Delete a file from an agent skill' })
  deleteSkillFile(
    @Param('id') id: string,
    @Query('path') relativePath: string,
  ) {
    return {
      success: true,
      data: this.aiConfigAdmin.deleteAgentSkillFile(id, relativePath),
    };
  }
}
