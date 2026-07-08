import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  Inject,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  WorkflowStatus,
  injectMessageSchema,
  submitQuestionAnswersSchema,
  type InjectMessageRequest,
  type SubmitQuestionAnswersRequest,
} from '@nexus/core';
import type { Request } from 'express';
import * as jwt from 'jsonwebtoken';
import { resolveWebSocketUrl } from '../../config/websocket-url.config';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { RedisStreamService } from '../../redis/redis-stream.service';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { PaginationQueryDto } from '../workflow.controller.dto';
import { WorkflowGraphReadModelService } from './workflow-graph-read-model.service';
import { WorkflowRunSteeringService } from './workflow-run-steering.service';
import { WorkflowRunTodoService } from './workflow-run-todo.service';
import { WorkflowRunWorkspaceService } from './workflow-run-workspace.service';
import { WorkflowSkillRuntimeDiagnosticsService } from '../workflow-skill-runtime-diagnostics.service';
import { WorkflowHostMountRuntimeDiagnosticsService } from '../workflow-host-mount/workflow-host-mount-runtime-diagnostics.service';
import { WorkflowFailureClassificationService } from '../workflow-repair/workflow-failure-classification.service';
import { WebAutomationArtifactQueryService } from '../../web-automation/web-automation-artifact-query.service';
import { WorkflowRunAutonomyDiagnosticsService } from './workflow-run-autonomy-diagnostics.service';
import { BudgetDecisionService } from '../../cost-governance/budget-decision.service';
import { requireJwtSecret } from '../../config/jwt-runtime-config';
import { WORKFLOW_PERSISTENCE_SERVICE } from '../kernel/interfaces/workflow-kernel.ports';
import type { IWorkflowPersistenceService } from '../kernel/interfaces/workflow-kernel.ports';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import {
  type ExecutionReadModel,
  toExecutionReadModel,
} from '../../execution-lifecycle/execution-read.types';
import { RetrospectiveTraceService } from '../workflow-retrospective/retrospective-trace.service';

@ApiTags('workflows')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflows')
export class WorkflowRunsController {
  constructor(
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    private readonly streamService: RedisStreamService,
    private readonly workflowRunSteering: WorkflowRunSteeringService,
    private readonly workflowRunTodoService: WorkflowRunTodoService,
    private readonly workflowRunWorkspace: WorkflowRunWorkspaceService,
    private readonly workflowGraphReadModel: WorkflowGraphReadModelService,
    private readonly workflowSkillDiagnostics: WorkflowSkillRuntimeDiagnosticsService,
    private readonly workflowHostMountDiagnostics: WorkflowHostMountRuntimeDiagnosticsService,
    private readonly webAutomationArtifacts: WebAutomationArtifactQueryService,
    private readonly failureClassification: WorkflowFailureClassificationService,
    private readonly autonomyDiagnostics: WorkflowRunAutonomyDiagnosticsService,
    private readonly budgetDecisionService: BudgetDecisionService,
    private readonly executionRepository: ExecutionRepository,
    private readonly retrospectiveTrace: RetrospectiveTraceService,
  ) {}

  private getTelemetryWsUrl(req: Request): string {
    const configuredUrl = resolveWebSocketUrl();
    if (configuredUrl) {
      return configuredUrl;
    }

    const host = req.hostname || '127.0.0.1';
    const protocol = req.secure ? 'https' : 'http';
    return `${protocol}://${host}:3001`;
  }

  private getPagination(query: PaginationQueryDto): {
    limit: number;
    offset: number;
  } {
    const limit = Number.isInteger(query.limit) ? query.limit : 20;
    const offset = Number.isInteger(query.offset) ? query.offset : 0;

    return { limit, offset };
  }

  @Get('runs/:runId')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get workflow run by ID' })
  async findRun(@Param('runId') runId: string) {
    const [run, latestBudgetDecision] = await Promise.all([
      this.workflowPersistence.getWorkflowRun(runId),
      this.budgetDecisionService.getLatestDecision('workflow_run', runId),
    ]);
    return { success: true, data: { ...run, latestBudgetDecision } };
  }

  @Get('runs/:runId/events')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get workflow run telemetry event history' })
  async findRunEvents(@Param('runId') runId: string) {
    await this.workflowPersistence.getWorkflowRun(runId);
    const events = await this.streamService.getEventHistory(runId);
    return { success: true, data: events };
  }

  @Get('runs/:runId/retrospective-trace')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get retrospective finding trace for a run' })
  async findRunRetrospectiveTrace(@Param('runId') runId: string) {
    await this.workflowPersistence.getWorkflowRun(runId);
    const trace = await this.retrospectiveTrace.getTrace(runId);
    return { success: true, data: trace };
  }

  @Get('runs/:runId/executions')
  @RequirePermission('workflows:read')
  @ApiOperation({
    summary: 'List agent executions with resolved provider/model for a run',
  })
  async listRunExecutions(
    @Param('runId') runId: string,
  ): Promise<ExecutionReadModel[]> {
    const rows = await this.executionRepository.findByWorkflowRun(runId);
    return rows.map(toExecutionReadModel);
  }

  @Get('runs/:runId/autonomy/diagnostics')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get workflow run autonomy diagnostics' })
  async findRunAutonomyDiagnostics(@Param('runId') runId: string) {
    await this.workflowPersistence.getWorkflowRun(runId);
    const diagnostics =
      await this.autonomyDiagnostics.getRunAutonomyDiagnostics(runId);
    return { success: true, data: diagnostics };
  }

  @Get('runs/:runId/web-automation-artifacts')
  @RequirePermission('workflows:read')
  @ApiOperation({
    summary: 'List persisted web automation failure artifacts for a run',
  })
  async findRunWebAutomationArtifacts(
    @Param('runId') runId: string,
    @Query() query: PaginationQueryDto,
  ) {
    await this.workflowPersistence.getWorkflowRun(runId);
    const { limit, offset } = this.getPagination(query);
    const artifacts = await this.webAutomationArtifacts.listRunArtifacts(
      runId,
      limit,
      offset,
    );

    return {
      success: true,
      data: artifacts.data,
      meta: {
        pagination: {
          total: artifacts.total,
          limit,
          offset,
        },
      },
    };
  }

  @Get('runs/:runId/web-automation-artifacts/:artifactId')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get detailed web automation failure artifact' })
  async findRunWebAutomationArtifact(
    @Param('runId') runId: string,
    @Param('artifactId') artifactId: string,
  ) {
    await this.workflowPersistence.getWorkflowRun(runId);
    const artifact = await this.webAutomationArtifacts.getRunArtifact(
      runId,
      artifactId,
    );

    return {
      success: true,
      data: artifact,
    };
  }

  @Get('runs/:runId/skills/diagnostics')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get runtime skill mount diagnostics for a run' })
  async findRunSkillDiagnostics(
    @Param('runId') runId: string,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    await this.workflowPersistence.getWorkflowRun(runId);
    const diagnostics =
      await this.workflowSkillDiagnostics.getRunSkillMountDiagnostics(runId);
    return {
      success: true,
      data: diagnostics as unknown as Record<string, unknown>,
    };
  }

  @Get('runs/:runId/host-mounts/diagnostics')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get runtime host mount diagnostics for a run' })
  async findRunHostMountDiagnostics(
    @Param('runId') runId: string,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    await this.workflowPersistence.getWorkflowRun(runId);
    const diagnostics =
      await this.workflowHostMountDiagnostics.getRunHostMountDiagnostics(runId);

    return {
      success: true,
      data: diagnostics,
    };
  }

  @Post('runs/:runId/failure-classification')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Classify a workflow run failure' })
  async classifyRunFailure(@Param('runId') runId: string) {
    const run = await this.workflowPersistence.getWorkflowRun(runId);
    if (run.status !== WorkflowStatus.FAILED) {
      throw new BadRequestException(
        `Workflow run ${runId} must be failed before failure classification`,
      );
    }

    const decision = await this.failureClassification.classifyRunFailure(runId);

    return { success: true, data: decision };
  }

  @Get('runs/:runId/graph')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get workflow run graph snapshot' })
  async findRunGraph(@Param('runId') runId: string) {
    const graph = await this.workflowGraphReadModel.getRunGraph(runId);
    return { success: true, data: graph };
  }

  @Get('runs/:runId/telemetry-auth')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get telemetry websocket auth token for a run' })
  async getRunTelemetryAuth(
    @Param('runId') runId: string,
    @Req() req: Request,
  ) {
    await this.workflowPersistence.getWorkflowRun(runId);

    const token = jwt.sign(
      {
        workflowRunId: runId,
        role: 'ui',
      },
      requireJwtSecret(),
      { expiresIn: '30m' },
    );

    return {
      success: true,
      data: {
        token,
        wsUrl: this.getTelemetryWsUrl(req),
      },
    };
  }

  @Post('runs/:runId/control/pause')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Pause active run container' })
  async pauseRun(@Param('runId') runId: string) {
    const result = await this.workflowRunSteering.pause(runId);
    return { success: true, data: result };
  }

  @Post('runs/:runId/control/resume')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Resume paused run container' })
  async resumeRun(@Param('runId') runId: string) {
    const result = await this.workflowRunSteering.resume(runId);
    return { success: true, data: result };
  }

  @Post('runs/:runId/control/abort')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Abort active run container' })
  async abortRun(@Param('runId') runId: string) {
    const result = await this.workflowRunSteering.abort(runId);
    return { success: true, data: result };
  }

  @Post('runs/:runId/inject')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Inject user guidance into run telemetry stream' })
  async injectRunMessage(
    @Param('runId') runId: string,
    @ZodBody(injectMessageSchema) dto: InjectMessageRequest,
  ) {
    const result = await this.workflowRunSteering.injectMessage(
      runId,
      dto.message,
    );
    return { success: true, data: result };
  }

  @Post('runs/:runId/question-answers')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Submit answers to agent-posed questions' })
  async submitQuestionAnswers(
    @Param('runId') runId: string,
    @ZodBody(submitQuestionAnswersSchema) dto: SubmitQuestionAnswersRequest,
  ) {
    const result = await this.workflowRunSteering.submitQuestionAnswers(
      runId,
      dto.answers,
    );
    return { success: true, data: result };
  }

  @Get('runs/:runId/todo-list')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get workflow run todo list' })
  async getRunTodoList(
    @Param('runId') runId: string,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.workflowRunTodoService.getTodoList(runId);
    return {
      success: true,
      data: data as unknown as Record<string, unknown>,
    };
  }

  @Post('runs/:runId/todo-list')
  @RequirePermission('workflows:update')
  @ApiOperation({ summary: 'Replace workflow run todo list state' })
  async updateRunTodoList(
    @Param('runId') runId: string,
    @Body()
    body: {
      todo_list?: Array<{
        id?: string;
        title?: string;
        status: 'not-started' | 'in-progress' | 'completed';
        source_context_item_id?: string;
      }>;
      todoList?: Array<{
        id?: string;
        title?: string;
        status: 'not-started' | 'in-progress' | 'completed';
        source_context_item_id?: string;
      }>;
    },
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.workflowRunTodoService.updateTodoList({
      workflowRunId: runId,
      todoList: body.todo_list ?? body.todoList ?? [],
    });

    return {
      success: true,
      data: data as unknown as Record<string, unknown>,
    };
  }

  @Get('runs/:runId/workspace/tree')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get workspace file tree for active run step' })
  async getRunWorkspaceTree(@Param('runId') runId: string) {
    const tree = await this.workflowRunWorkspace.getFileTree(runId);
    return { success: true, data: tree };
  }

  @Get('runs/:runId/workspace/diff')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get current git diff for active run workspace' })
  async getRunWorkspaceDiff(@Param('runId') runId: string) {
    const diff = await this.workflowRunWorkspace.getDiff(runId);
    return { success: true, data: { diff } };
  }

  @Get('runs/:runId/workspace/file')
  @RequirePermission('workflows:read')
  @ApiOperation({ summary: 'Get file content from active run workspace' })
  async getRunWorkspaceFileContent(
    @Param('runId') runId: string,
    @Query('path') filePath: string,
  ) {
    if (!filePath || typeof filePath !== 'string' || !filePath.trim()) {
      throw new BadRequestException('path query parameter is required');
    }

    const content = await this.workflowRunWorkspace.getFileContent(
      runId,
      filePath.trim(),
    );
    return { success: true, data: { content } };
  }
}
