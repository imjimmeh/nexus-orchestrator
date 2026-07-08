import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateMcpServerSchema,
  InvokeMcpToolSchema,
  UpdateMcpServerSchema,
} from '@nexus/core';
import type {
  CreateMcpServerRequest,
  InvokeMcpToolRequest,
  UpdateMcpServerRequest,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import type { AuthenticatedRequest } from '../workflow/workflow-runtime/workflow-runtime-tools.controller.types';
import { McpService } from './mcp.service';
import type { McpRuntimeContext } from './mcp.types';

@ApiTags('mcp')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('mcp')
export class McpController {
  constructor(private readonly mcpService: McpService) {}

  @Get('servers')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List MCP server configurations' })
  async listServers() {
    const data = await this.mcpService.listServers();
    return { success: true, data };
  }

  @Post('servers')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Create MCP server configuration' })
  async createServer(
    @ZodBody(CreateMcpServerSchema) dto: CreateMcpServerRequest,
  ) {
    const data = await this.mcpService.createServer(dto);
    return { success: true, data };
  }

  @Patch('servers/:id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Update MCP server configuration' })
  async updateServer(
    @Param('id') id: string,
    @ZodBody(UpdateMcpServerSchema) dto: UpdateMcpServerRequest,
  ) {
    const data = await this.mcpService.updateServer(id, dto);
    return { success: true, data };
  }

  @Delete('servers/:id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Delete MCP server configuration' })
  async deleteServer(@Param('id') id: string) {
    const data = await this.mcpService.deleteServer(id);
    return { success: true, data };
  }

  @Post('servers/:id/test')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Test MCP server connectivity and discovery' })
  async testServer(@Param('id') id: string) {
    const data = await this.mcpService.testServer(id);
    return { success: true, data };
  }

  @Get('servers/:id/tools')
  @RequirePermission('agents:read')
  @ApiOperation({
    summary: 'List runtime tool registry rows linked to an MCP server',
  })
  async listServerTools(@Param('id') id: string) {
    const data = await this.mcpService.listServerTools(id);
    return { success: true, data };
  }

  @Post('servers/:id/reload')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Reload a single MCP server tool catalog' })
  async reloadServer(@Param('id') id: string) {
    const data = await this.mcpService.reloadServer(id);
    return { success: true, data };
  }

  @Post('reload')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Reload all enabled MCP servers' })
  async reloadAllServers() {
    const data = await this.mcpService.reloadAllServers();
    return { success: true, data };
  }

  @Post('servers/:id/tools/:toolName/invoke')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Invoke remote MCP tool' })
  async invokeTool(
    @Param('id') id: string,
    @Param('toolName') toolName: string,
    @ZodBody(InvokeMcpToolSchema) dto: InvokeMcpToolRequest,
    @Req() req: AuthenticatedRequest,
  ) {
    const data = await this.mcpService.invokeTool(
      id,
      toolName,
      dto.params ?? {},
      this.readRuntimeContext(req),
    );
    return { success: true, data };
  }

  private readRuntimeContext(req: AuthenticatedRequest): McpRuntimeContext {
    const workflowRunId =
      this.readHeader(req, 'x-workflow-run-id') ?? req.user?.workflowRunId;
    const jobId = this.readHeader(req, 'x-job-id') ?? req.user?.jobId;
    const stepId = this.readHeader(req, 'x-step-id') ?? req.user?.stepId;
    // Scope lets scope-aware MCP servers infer their domain id without the agent
    // passing it. x-scope-id is canonical; runners on older dists still send the
    // scope via x-correlation-id, so accept that before the JWT-derived value.
    const scopeId =
      this.readHeader(req, 'x-scope-id') ??
      this.readHeader(req, 'x-correlation-id') ??
      req.user?.scopeId;

    return {
      ...(workflowRunId ? { workflowRunId } : {}),
      ...(jobId ? { jobId } : {}),
      ...(stepId ? { stepId } : {}),
      ...(scopeId ? { scopeId } : {}),
    };
  }

  private readHeader(
    req: AuthenticatedRequest,
    name: string,
  ): string | undefined {
    const value = req.headers[name];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const first = value.find((entry) => entry.trim().length > 0);
      return first?.trim();
    }
    return undefined;
  }
}
