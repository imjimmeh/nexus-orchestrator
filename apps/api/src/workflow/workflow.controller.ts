import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  ParseUUIDPipe,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Inject,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

interface AuthenticatedRequest extends Request {
  user: { userId: string };
}
import { WorkflowEventLogService } from './workflow-event-log.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { ScopeAccessService } from '../auth/authorization/scope-access.service';
import { WorkflowGraphReadModelService } from './workflow-run-operations/workflow-graph-read-model.service';
import { WorkflowResolutionService } from './services/workflow-resolution.service';
import {
  CreateWorkflowDto,
  PaginationQueryDto,
  WorkflowRunsQueryDto,
  WorkflowEventsQueryDto,
} from './workflow.controller.dto';
import { WORKFLOW_PERSISTENCE_SERVICE } from './kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowPersistenceService } from './kernel/interfaces/workflow-kernel.ports';

@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflows')
export class WorkflowController {
  constructor(
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly workflowGraphReadModel: WorkflowGraphReadModelService,
    private readonly workflowEventLog: WorkflowEventLogService,
    private readonly scopeAccess: ScopeAccessService,
    private readonly workflowResolution: WorkflowResolutionService,
  ) {}

  private getPagination(query: PaginationQueryDto): {
    limit: number;
    offset: number;
  } {
    const limit = Number.isInteger(query.limit) ? query.limit : 20;
    const offset = Number.isInteger(query.offset) ? query.offset : 0;

    return { limit, offset };
  }

  private async updateWorkflowById(
    id: string,
    updateWorkflowDto: CreateWorkflowDto,
    actorId?: string,
  ) {
    const workflow = await this.workflowPersistence.updateWorkflow(
      id,
      updateWorkflowDto.yaml_definition,
      actorId,
    );
    return { success: true, data: workflow };
  }

  @Post()
  @RequirePermission('workflows:create')
  @ApiOperation({ summary: 'Create a new workflow' })
  async create(@Body() createWorkflowDto: CreateWorkflowDto) {
    const workflow = await this.workflowPersistence.createWorkflow(
      createWorkflowDto.yaml_definition,
    );
    return { success: true, data: workflow };
  }

  @Get()
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List all workflows' })
  async findAll(
    @Query() query: PaginationQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const { limit, offset } = this.getPagination(query);

    if (query.workflowId) {
      const runs = await this.workflowPersistence.getWorkflowRunsPaged(
        { limit, offset },
        {
          workflowId: query.workflowId,
        },
      );

      return {
        success: true,
        data: runs.data,
        meta: {
          pagination: {
            total: runs.total,
            limit,
            offset,
          },
        },
      };
    }

    const userId = req.user.userId;
    // An out-of-subtree scopeNodeId collapses to an empty scopeIds set below;
    // platform/global (NULL-scoped) workflows still stay visible in that case
    // (enforced by the repository's NULL-inclusive filtering), matching the
    // "platform stays visible" pattern used across the other scoped list
    // endpoints (agent-profiles, providers, budget policies, gitops bindings).
    const scopeIds = await this.scopeAccess.restrictToAccessibleScopes(
      userId,
      'workflows:read',
      query.scopeNodeId,
    );
    const workflows = await this.workflowPersistence.getAllWorkflowsPaged(
      { limit, offset },
      {
        includeInactive: query.includeInactive === true,
        isActive: query.isActive,
        search: query.search,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
        scopeIds,
      },
    );

    return {
      success: true,
      data: workflows.data,
      meta: {
        pagination: {
          total: workflows.total,
          limit,
          offset,
        },
      },
    };
  }

  @Get('runs')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List workflow runs' })
  async findRuns(@Query() query: WorkflowRunsQueryDto) {
    const { limit, offset } = this.getPagination(query);
    const runs = await this.workflowPersistence.getWorkflowRunsPaged(
      { limit, offset },
      {
        workflowId: query.workflowId,
        scopeId: query.scopeId,
        contextId: query.contextId,
        status: query.status,
        search: query.search,
        sourceType: query.sourceType,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
    );

    return {
      success: true,
      data: runs.data,
      meta: {
        pagination: {
          total: runs.total,
          limit,
          offset,
        },
      },
    };
  }

  @Get('events')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List persisted workflow events' })
  async findEvents(@Query() query: WorkflowEventsQueryDto) {
    const { limit, offset } = this.getPagination(query);
    const events = await this.workflowEventLog.getPagedHistory(
      { limit, offset },
      {
        scopeId: query.scopeId,
        search: query.search,
        sortBy: query.sortBy,
        sortDir: query.sortDir,
      },
    );

    return {
      success: true,
      data: events.events,
      meta: {
        pagination: {
          total: events.total,
          limit,
          offset,
        },
      },
    };
  }

  @Get('resolve/:name')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get effective workflow for a scope' })
  async resolveWorkflow(
    @Param('name') name: string,
    @Query('scopeNodeId') scopeNodeId?: string,
  ) {
    return {
      success: true,
      data: await this.workflowResolution.resolve(name, scopeNodeId ?? null),
    };
  }

  @Post(':id/scopes/:scopeNodeId/override')
  @RequirePermission('workflows:create')
  @ApiOperation({ summary: 'Fork workflow for a specific scope' })
  async forkWorkflowForScope(
    @Param('id', ParseUUIDPipe) baseId: string,
    @Param('scopeNodeId', ParseUUIDPipe) scopeNodeId: string,
    @Body() dto: CreateWorkflowDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return {
      success: true,
      data: await this.workflowPersistence.createScopedOverride(
        baseId,
        scopeNodeId,
        dto.yaml_definition,
        req.user.userId,
      ),
    };
  }

  @Get(':id/graph')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get static workflow graph' })
  async getWorkflowGraph(@Param('id', ParseUUIDPipe) id: string) {
    const graph = await this.workflowGraphReadModel.getWorkflowGraph(id);
    return { success: true, data: graph };
  }

  @Get(':id')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get workflow by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const workflow = await this.workflowPersistence.getWorkflow(id);
    return { success: true, data: workflow };
  }

  @Put(':id')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Update workflow' })
  async updatePut(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateWorkflowDto: CreateWorkflowDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.updateWorkflowById(id, updateWorkflowDto, req.user.userId);
  }

  @Patch(':id')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Partially update workflow' })
  async updatePatch(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateWorkflowDto: CreateWorkflowDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.updateWorkflowById(id, updateWorkflowDto, req.user.userId);
  }

  @Delete(':id')
  @RequirePermission('workflows:delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete (deactivate) workflow' })
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.workflowPersistence.deleteWorkflow(id, req.user.userId);
  }
}
