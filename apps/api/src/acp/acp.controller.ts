import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateAcpServerSchema,
  InvokeAcpAgentSchema,
  UpdateAcpServerSchema,
} from '@nexus/core';
import type {
  CreateAcpServerRequest,
  InvokeAcpAgentRequest,
  UpdateAcpServerRequest,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { AcpService } from './acp.service';

@ApiTags('acp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('acp')
export class AcpController {
  constructor(private readonly acpService: AcpService) {}

  @Get('servers')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List ACP server configurations' })
  async listServers() {
    const data = await this.acpService.listServers();
    return { success: true, data };
  }

  @Post('servers')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Create ACP server configuration' })
  async createServer(
    @ZodBody(CreateAcpServerSchema) dto: CreateAcpServerRequest,
  ) {
    const data = await this.acpService.createServer(dto);
    return { success: true, data };
  }

  @Patch('servers/:id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Update ACP server configuration' })
  async updateServer(
    @Param('id') id: string,
    @ZodBody(UpdateAcpServerSchema) dto: UpdateAcpServerRequest,
  ) {
    const data = await this.acpService.updateServer(id, dto);
    return { success: true, data };
  }

  @Delete('servers/:id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Delete ACP server configuration' })
  async deleteServer(@Param('id') id: string) {
    await this.acpService.deleteServer(id);
    return { success: true };
  }

  @Post('servers/:id/test')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Test ACP server connectivity and discovery' })
  async testServer(@Param('id') id: string) {
    const data = await this.acpService.testServer(id);
    return { success: true, data };
  }

  @Post('servers/:id/reload')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Reload a single ACP server agent catalog' })
  async reloadServer(@Param('id') id: string) {
    const data = await this.acpService.reloadServer(id);
    return { success: true, data };
  }

  @Post('reload')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Reload all enabled ACP servers' })
  async reloadAllServers() {
    const data = await this.acpService.reloadAllServers();
    return { success: true, data };
  }

  @Get('servers/:id/agents')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List discovered agents on an ACP server' })
  async listDiscoveredAgents(@Param('id') id: string) {
    const data = await this.acpService.listDiscoveredAgents(id);
    return { success: true, data };
  }

  @Get('servers/:id/agents/:agentName')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get agent manifest from an ACP server' })
  async getAgentManifest(
    @Param('id') id: string,
    @Param('agentName') agentName: string,
  ) {
    const data = await this.acpService.getAgentManifest(id, agentName);
    return { success: true, data };
  }

  @Post('servers/:id/agents/:agentName/invoke')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Invoke an agent on an ACP server' })
  async invokeAgent(
    @Param('id') id: string,
    @Param('agentName') agentName: string,
    @ZodBody(InvokeAcpAgentSchema) dto: InvokeAcpAgentRequest,
  ) {
    const data = await this.acpService.invokeAgent(
      id,
      agentName,
      dto.params ?? {},
      dto.run_mode,
    );
    return { success: true, data };
  }
}
