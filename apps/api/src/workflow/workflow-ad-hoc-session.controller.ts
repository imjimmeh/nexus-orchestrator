import {
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  Inject,
} from '@nestjs/common';
import {
  listAdHocSessionsQuerySchema,
  type ListAdHocSessionsQueryRequest,
} from '@nexus/core';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AgentProfileRepository } from '../ai-config/database/repositories/agent-profile.repository';
import { PiSessionTreeRepository } from '../runtime/database/repositories/pi-session-tree.repository';
import { RedisStreamService } from '../redis/redis-stream.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/authorization/permissions.guard';
import { RequirePermission } from '../auth/authorization/require-permission.decorator';
import { buildWorkflowRunRequestV1 } from './workflow-run-operations/workflow-run-request.contract';
import { CreateAdHocSessionDto } from './workflow-ad-hoc-session.dto';
import { ZodQuery } from '../common/decorators/zod-query.decorator';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowEngineService,
  type IWorkflowRunRepository,
} from './kernel/interfaces/workflow-kernel.ports';

const AD_HOC_WORKFLOW_ID = 'orchestration_invoke_agent_default';
const AD_HOC_SOURCE = 'ad-hoc';

type ListAdHocSessionsQueryDto = ListAdHocSessionsQueryRequest;

@ApiTags('sessions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('sessions')
export class WorkflowAdHocSessionController {
  private readonly logger = new Logger(WorkflowAdHocSessionController.name);

  constructor(
    private readonly agentProfileRepo: AgentProfileRepository,
    private readonly sessionTreeRepo: PiSessionTreeRepository,
    private readonly streamService: RedisStreamService,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly workflowRunRepo: IWorkflowRunRepository,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
  ) {}

  @Post('ad-hoc')
  @RequirePermission('workflows:create')
  @ApiOperation({ summary: 'Start an ad-hoc agent session' })
  async createAdHocSession(@Body() dto: CreateAdHocSessionDto) {
    const profile = await this.agentProfileRepo.findByName(
      dto.agentProfileName,
    );
    if (!profile) {
      throw new NotFoundException(
        `Agent profile '${dto.agentProfileName}' not found or inactive`,
      );
    }

    const triggerData: Record<string, unknown> = {
      agent_profile: profile.name,
      scopeId: dto.scopeId ?? null,
      objective: 'User-initiated ad-hoc session',
      task_prompt: dto.initialMessage,
      source: AD_HOC_SOURCE,
      display_name: `Chat with ${profile.name}`,
    };

    const runRequest = buildWorkflowRunRequestV1({
      workflow_id: AD_HOC_WORKFLOW_ID,
      input: triggerData,
      launch_source: AD_HOC_SOURCE,
      context: dto.scopeId
        ? {
            scopeId: dto.scopeId,
            contextId: dto.scopeId,
            contextType: 'scope',
            scopeNodeId: null,
            scopePath: null,
          }
        : null,
      requested_by: 'workflow-ad-hoc-session.controller',
    });

    const runId = await this.workflowEngine.startWorkflow(
      runRequest.workflow_id,
      runRequest.input,
    );

    if (!runId) {
      this.logger.warn(
        `Ad-hoc session start returned null for agent ${profile.name}`,
      );
      return { success: false, error: 'Failed to start ad-hoc session' };
    }

    return { success: true, data: { runId } };
  }

  @Get('ad-hoc')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'List ad-hoc sessions' })
  async listAdHocSessions(
    @ZodQuery(listAdHocSessionsQuerySchema) query: ListAdHocSessionsQueryDto,
  ) {
    const runs = await this.workflowRunRepo.findAdHocSessions({
      scopeId: query.scopeId,
      status: query.status,
      limit: query.limit,
      offset: query.offset,
    });

    const items = runs.map((run) => {
      const trigger = (run.state_variables?.trigger ?? {}) as Record<
        string,
        unknown
      >;
      const runScopeId =
        typeof trigger.scopeId === 'string' ? trigger.scopeId : null;

      const agentName =
        typeof trigger.agent_profile === 'string'
          ? trigger.agent_profile
          : 'unknown';
      const displayName =
        typeof trigger.display_name === 'string'
          ? trigger.display_name
          : `Run ${run.id.slice(0, 8)}`;
      const initialMessage =
        typeof trigger.task_prompt === 'string' ? trigger.task_prompt : '';

      return {
        runId: run.id,
        agentProfileName: agentName,
        scopeId: runScopeId,
        projectName: null,
        status: run.status,
        displayName,
        initialMessage,
        createdAt: run.created_at,
        completedAt: run.updated_at,
      };
    });

    return { success: true, data: items };
  }

  @Get(':id')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get session metadata by ID' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    const session = await this.sessionTreeRepo.findById(id);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    return {
      success: true,
      data: {
        id: session.id,
        workflow_run_id: session.workflow_run_id,
        last_leaf_node_id: session.last_leaf_node_id,
        created_at: session.created_at,
      },
    };
  }

  @Get(':id/events')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get session event history' })
  async findEvents(@Param('id', ParseUUIDPipe) id: string) {
    const session = await this.sessionTreeRepo.findById(id);
    if (!session) {
      return { success: false, error: 'Session not found' };
    }

    const events = await this.streamService.getEventHistory(
      session.workflow_run_id ?? session.id,
    );
    return { success: true, data: events };
  }
}
