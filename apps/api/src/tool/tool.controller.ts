import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ToolRegistryService } from '../tool-registry/tool-registry.service';
import {
  candidatePaginationSchema,
  createCandidateDraftSchema,
  createToolSchema,
  executePublishedToolSchema,
  toolPaginationSchema,
  type CandidateLanguage,
  type CandidateStatus,
  type CreateCandidateDraftRequest,
  type CreateToolRequest,
  type ExecutePublishedToolRequest,
  type ToolPaginationRequest,
  type UpdateToolRequest,
  type UpsertToolRequest,
  updateToolSchema,
  upsertToolSchema,
  ContainerTier,
  SortDirection,
  ToolSortField,
} from '@nexus/core';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ToolCandidateService } from '../tool-runtime/tool-candidate.service';
import { ToolRuntimeExecutionService } from '../tool-runtime/tool-runtime-execution.service';

class CreateToolDto implements CreateToolRequest {
  static get schema() {
    return createToolSchema;
  }

  name!: string;

  schema!: Record<string, unknown>;

  typescript_code!: string;

  tier_restriction: number = 0;

  language?: CandidateLanguage;

  publication_status?: CandidateStatus;

  published_artifact_id?: string | null;

  published_version?: number | null;
}

class UpsertToolDto implements UpsertToolRequest {
  static get schema() {
    return upsertToolSchema;
  }

  name!: string;

  schema!: Record<string, unknown>;

  typescript_code!: string;

  tier_restriction: number = 0;

  language?: CandidateLanguage;

  publication_status?: CandidateStatus;

  published_artifact_id?: string | null;

  published_version?: number | null;
}

class UpdateToolDto implements UpdateToolRequest {
  static get schema() {
    return updateToolSchema;
  }

  name?: string;

  schema?: Record<string, unknown>;

  typescript_code?: string;

  tier_restriction?: number;

  language?: CandidateLanguage;

  publication_status?: CandidateStatus;

  published_artifact_id?: string | null;

  published_version?: number | null;
}

class ToolPaginationDto implements ToolPaginationRequest {
  static get schema() {
    return toolPaginationSchema;
  }

  limit: number = 20;

  offset: number = 0;

  search?: string;

  sortBy: ToolSortField = ToolSortField.NAME;

  sortDir: SortDirection = SortDirection.ASC;
}

class CreateCandidateDraftDto implements CreateCandidateDraftRequest {
  static get schema() {
    return createCandidateDraftSchema;
  }

  tool_name!: string;

  language: CandidateLanguage = 'node';

  source_code!: string;

  schema!: Record<string, unknown>;

  test_spec?: string;
}

class CandidatePaginationDto extends ToolPaginationDto {
  static get schema() {
    return candidatePaginationSchema;
  }

  status?: CandidateStatus;

  tool_name?: string;
}

class ExecutePublishedToolDto implements ExecutePublishedToolRequest {
  static get schema() {
    return executePublishedToolSchema;
  }

  params?: Record<string, unknown>;
}

@ApiTags('tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('tools')
export class ToolController {
  constructor(
    private readonly toolService: ToolRegistryService,
    private readonly toolCandidateService: ToolCandidateService,
    private readonly runtimeExecutionService: ToolRuntimeExecutionService,
  ) {}

  @Post()
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Register a new tool' })
  async create(@Body() createToolDto: CreateToolDto) {
    const tool = await this.toolService.createTool(createToolDto);
    return { success: true, data: tool };
  }

  @Post('upsert')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Upsert tool by name (create or update)' })
  async upsert(@Body() upsertToolDto: UpsertToolDto) {
    const tool = await this.toolService.upsertTool(upsertToolDto);
    return { success: true, data: tool };
  }

  @Get()
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List all registered tools' })
  async findAll(@Query() query: ToolPaginationDto) {
    let tools = await this.toolService.getToolsForTier(ContainerTier.HEAVY);

    if (query.search) {
      const needle = query.search.toLowerCase();
      tools = tools.filter((t) => t.name.toLowerCase().includes(needle));
    }

    tools = tools.slice().sort((a, b) => {
      const aVal =
        query.sortBy === ToolSortField.TIER ? a.tier_restriction : a.name;
      const bVal =
        query.sortBy === ToolSortField.TIER ? b.tier_restriction : b.name;
      if (aVal < bVal) return query.sortDir === SortDirection.ASC ? -1 : 1;
      if (aVal > bVal) return query.sortDir === SortDirection.ASC ? 1 : -1;
      return 0;
    });

    const total = tools.length;
    const sliced = tools.slice(query.offset, query.offset + query.limit);
    return {
      success: true,
      data: sliced,
      meta: {
        pagination: {
          total,
          limit: query.limit,
          offset: query.offset,
        },
      },
    };
  }

  @Post('candidates')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Create a tool candidate draft' })
  async createCandidateDraft(@Body() dto: CreateCandidateDraftDto) {
    const artifact = await this.toolCandidateService.createDraft(dto);
    return { success: true, data: artifact };
  }

  @Get('candidates')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List tool candidates' })
  async listCandidates(@Query() query: CandidatePaginationDto) {
    const result = await this.toolCandidateService.listCandidates(query);
    return {
      success: true,
      data: result.items,
      meta: {
        pagination: {
          total: result.total,
          limit: query.limit,
          offset: query.offset,
        },
      },
    };
  }

  @Get('candidates/:id')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get tool candidate by ID' })
  async getCandidate(@Param('id') id: string) {
    const artifact = await this.toolCandidateService.getCandidate(id);
    return { success: true, data: artifact };
  }

  @Get('candidates/:id/validation-runs')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'List validation runs for a tool candidate' })
  async listValidationRuns(
    @Param('id') id: string,
    @Query() query: ToolPaginationDto,
  ) {
    const result = await this.toolCandidateService.listValidationRuns(
      id,
      query,
    );
    return {
      success: true,
      data: result.items,
      meta: {
        pagination: {
          total: result.total,
          limit: query.limit,
          offset: query.offset,
        },
      },
    };
  }

  @Post('candidates/:id/validate')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Run validation for a tool candidate' })
  async validateCandidate(@Param('id') id: string) {
    const result = await this.toolCandidateService.validateCandidate(id);
    return { success: true, data: result };
  }

  @Post('candidates/:id/publish')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Publish a validated tool candidate' })
  async publishCandidate(@Param('id') id: string) {
    const result = await this.toolCandidateService.publishCandidate(id);
    return { success: true, data: result };
  }

  @Post('runtime/:toolName/execute')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Execute active published tool by name' })
  async executePublishedTool(
    @Param('toolName') toolName: string,
    @Body() dto: ExecutePublishedToolDto,
  ) {
    const result = await this.runtimeExecutionService.executePublishedTool(
      toolName,
      dto.params ?? {},
    );
    return { success: true, data: result };
  }

  @Get(':id')
  @RequirePermission('agents:read')
  @ApiOperation({ summary: 'Get tool by ID' })
  async findOne(@Param('id') id: string) {
    const tool = await this.toolService.getTool(id);
    return { success: true, data: tool };
  }

  @Patch(':id')
  @RequirePermission('agents:manage')
  @ApiOperation({ summary: 'Update a registered tool' })
  async update(@Param('id') id: string, @Body() dto: UpdateToolDto) {
    const tool = await this.toolService.updateTool(id, dto);
    return { success: true, data: tool };
  }

  @Delete(':id')
  @RequirePermission('agents:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a tool' })
  async remove(@Param('id') id: string) {
    await this.toolService.deleteTool(id);
  }
}
