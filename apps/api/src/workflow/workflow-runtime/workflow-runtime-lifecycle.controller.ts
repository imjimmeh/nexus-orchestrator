import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  awaitAgentWorkflowBodySchema,
  getAgentProfileBodySchema,
  getAgentProfilesBodySchema,
  getCapabilitiesBodySchema,
  getTodoListBodySchema,
  invokeAgentWorkflowBodySchema,
  listAgentProfileNamesBodySchema,
  listPathBodySchema,
  listRunningWorkflowsBodySchema,
  manageTodoListBodySchema,
  runtimeRecordLearningBodySchema,
  runtimeRememberBodySchema,
  runtimeQueryMemoryBodySchema,
  runtimeRecordStrategicIntentBodySchema,
  runtimeReadStrategicIntentBodySchema,
  setJobOutputBodySchema,
  updateOrchestrationStateBodySchema,
  yieldSessionBodySchema,
} from '@nexus/core';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { ZodBody } from '../../common/decorators/zod-body.decorator';
import { WorkflowRuntimeOrchestrationActionsService } from './workflow-runtime-orchestration-actions.service';
import { WorkflowRuntimeAwaitActionsService } from './workflow-runtime-await-actions.service';
import { WorkflowRuntimeRunningWorkflowsService } from './workflow-runtime-running-workflows.service';
import { WorkflowRuntimeOrchestrationSessionService } from './workflow-runtime-orchestration-session.service';
import { WorkflowRuntimeSetJobOutputService } from './workflow-runtime-set-job-output.service';
import { WorkflowRuntimeToolsService } from './workflow-runtime-tools.service';
import { parseAgentExecutionContext } from './workflow-runtime-tools.context';
import { EventLedgerService } from '../../observability/event-ledger.service';
import { resolveSetJobOutputContext } from './workflow-runtime-set-job-output-context.helpers';
import type { AuthenticatedRequest } from './workflow-runtime-tools.controller.types';

export { invokeAgentWorkflowBodySchema, setJobOutputBodySchema };

type GetTodoListBody = z.infer<typeof getTodoListBodySchema>;
type ManageTodoListBody = z.infer<typeof manageTodoListBodySchema>;

type SetJobOutputBody = z.infer<typeof setJobOutputBodySchema>;

type GetCapabilitiesBody = z.infer<typeof getCapabilitiesBodySchema>;
type QueryMemoryBody = z.infer<typeof runtimeQueryMemoryBodySchema>;
type RecordLearningBody = z.infer<typeof runtimeRecordLearningBodySchema>;
type RememberRuntimeBody = z.infer<typeof runtimeRememberBodySchema>;
type RecordStrategicIntentBody = z.infer<
  typeof runtimeRecordStrategicIntentBodySchema
>;
type ReadStrategicIntentBody = z.infer<
  typeof runtimeReadStrategicIntentBodySchema
>;
type InvokeAgentWorkflowBody = z.infer<typeof invokeAgentWorkflowBodySchema>;
type AwaitAgentWorkflowBody = z.infer<typeof awaitAgentWorkflowBodySchema>;
type ListRunningWorkflowsBody = z.infer<typeof listRunningWorkflowsBodySchema>;
type YieldSessionBody = z.infer<typeof yieldSessionBodySchema>;
type ListPathBody = z.infer<typeof listPathBodySchema>;
type UpdateOrchestrationStateBody = z.infer<
  typeof updateOrchestrationStateBodySchema
>;

type GetAgentProfilesBody = z.infer<typeof getAgentProfilesBodySchema>;
type GetAgentProfileBody = z.infer<typeof getAgentProfileBodySchema>;
type ListAgentProfileNamesBody = z.infer<
  typeof listAgentProfileNamesBodySchema
>;

@ApiTags('workflow-runtime-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime')
export class WorkflowRuntimeLifecycleController {
  constructor(
    private readonly setJobOutputService: WorkflowRuntimeSetJobOutputService,
    private readonly eventLedger: EventLedgerService,
    private readonly runtimeTools: WorkflowRuntimeToolsService,
    private readonly orchestrationActions: WorkflowRuntimeOrchestrationActionsService,
    private readonly awaitActions: WorkflowRuntimeAwaitActionsService,
    private readonly orchestrationSession: WorkflowRuntimeOrchestrationSessionService,
    private readonly runningWorkflows: WorkflowRuntimeRunningWorkflowsService,
  ) {}

  @ApiOperation({
    summary:
      'Persist structured job output from agent container. Data is merged and validated against output_contract after execution.',
  })
  @Post('jobs/set-output')
  @RequirePermission('workflows:update')
  async setJobOutput(
    @Req() req: AuthenticatedRequest,
    @ZodBody(setJobOutputBodySchema) body: SetJobOutputBody,
  ): Promise<{ ok: boolean }> {
    const agentContext = parseAgentExecutionContext(req.user?.userId);
    const requestedWorkflowRunId = body.workflow_run_id?.trim();
    const requestedJobId = body.job_id?.trim();

    const { workflowRunId, jobId } = await resolveSetJobOutputContext({
      agentContext,
      requestedWorkflowRunId,
      requestedJobId,
      emitContextMismatch: async ({
        workflowRunId: contextWorkflowRunId,
        jobId: contextJobId,
        field,
        provided,
        expected,
      }) => {
        await this.eventLedger.emitBestEffort({
          domain: 'workflow',
          eventName: 'workflow.runtime.set_job_output.context_mismatch',
          outcome: 'denied',
          workflowRunId: contextWorkflowRunId,
          jobId: contextJobId,
          toolName: 'set_job_output',
          errorCode: 'set_job_output_context_mismatch',
          errorMessage:
            field === 'workflow_run_id'
              ? 'Provided workflow_run_id does not match agent execution context.'
              : 'Provided job_id does not match agent execution context.',
          payload:
            field === 'workflow_run_id'
              ? {
                  provided_workflow_run_id: provided,
                  expected_workflow_run_id: expected,
                }
              : {
                  provided_job_id: provided,
                  expected_job_id: expected,
                },
        });
      },
    });

    await this.setJobOutputService.setJobOutput(
      workflowRunId,
      jobId,
      body.data,
    );
    return { ok: true };
  }

  @ApiOperation({
    summary: 'Discover runtime capabilities for the current execution context.',
  })
  @Post('get-capabilities')
  @RequirePermission('workflows:update')
  async getCapabilities(
    @Req() req: AuthenticatedRequest,
    @ZodBody(getCapabilitiesBodySchema) body: GetCapabilitiesBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.getCapabilities({
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      chat_session_id: body.chat_session_id,
      user: req.user,
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Query persisted memory through the internal tool runtime.',
  })
  @Post('query-memory')
  @RequirePermission('workflows:update')
  async queryMemory(
    @Req() req: AuthenticatedRequest,
    @ZodBody(runtimeQueryMemoryBodySchema) body: QueryMemoryBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.executeInternalTool({
      name: 'query_memory',
      payload: {
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        ...(body.query !== undefined ? { query: body.query } : {}),
        ...(body.memory_type !== undefined
          ? { memory_type: body.memory_type }
          : {}),
        ...(body.include_learning !== undefined
          ? { include_learning: body.include_learning }
          : {}),
        include_provenance: body.include_provenance,
      },
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: req.user,
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary:
      'Submit governed learning input through the internal tool runtime.',
  })
  @Post('record-learning')
  @RequirePermission('workflows:update')
  async recordLearning(
    @Req() req: AuthenticatedRequest,
    @ZodBody(runtimeRecordLearningBodySchema) body: RecordLearningBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const agentContext = parseAgentExecutionContext(req.user?.userId);
    const hasBodyContext =
      body.workflow_run_id !== undefined && body.job_id !== undefined;
    const hasAgentContext =
      agentContext?.workflowRunId !== undefined &&
      agentContext.jobId !== undefined;

    if (!hasBodyContext && !hasAgentContext) {
      throw new BadRequestException(
        'record_learning requires workflow_run_id and job_id in the request body or agent token context.',
      );
    }

    const data = await this.runtimeTools.executeInternalTool({
      name: 'record_learning',
      payload: {
        scope_type: body.scope_type,
        ...(body.scope_id !== undefined ? { scope_id: body.scope_id } : {}),
        lesson: body.lesson,
        evidence: body.evidence,
        confidence: body.confidence,
        tags: body.tags,
      },
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: req.user,
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary:
      'Record a durable memory from a single agent call through the internal tool runtime.',
  })
  @Post('remember')
  @RequirePermission('workflows:update')
  async remember(
    @Req() req: AuthenticatedRequest,
    @ZodBody(runtimeRememberBodySchema) body: RememberRuntimeBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.executeInternalTool({
      name: 'remember',
      payload: {
        content: body.content,
        memory_type: body.memory_type,
        scope: body.scope,
        tags: body.tags,
        origin: body.origin,
        ...(body.confidence !== undefined
          ? { confidence: body.confidence }
          : {}),
      },
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: req.user,
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary:
      'Persist the CEO cycle strategic intent (horizon, priority themes, focus areas, constraints) as a singleton memory segment for the scope.',
  })
  @Post('record-strategic-intent')
  @RequirePermission('workflows:update')
  async recordStrategicIntent(
    @Req() req: AuthenticatedRequest,
    @ZodBody(runtimeRecordStrategicIntentBodySchema)
    body: RecordStrategicIntentBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.executeInternalTool({
      name: 'record_strategic_intent',
      payload: {
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        intent: body.intent,
      },
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: req.user,
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary:
      'Read the current CEO cycle strategic intent for a scope so future cycles can recall what was planned.',
  })
  @Post('read-strategic-intent')
  @RequirePermission('workflows:update')
  async readStrategicIntent(
    @Req() req: AuthenticatedRequest,
    @ZodBody(runtimeReadStrategicIntentBodySchema)
    body: ReadStrategicIntentBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.executeInternalTool({
      name: 'read_strategic_intent',
      payload: {
        entity_type: body.entity_type,
        entity_id: body.entity_id,
      },
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      user: req.user,
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Get the current workflow run todo list.',
  })
  @Post('get-todo-list')
  @RequirePermission('workflows:update')
  async getTodoList(
    @Req() req: AuthenticatedRequest,
    @ZodBody(getTodoListBodySchema) body: GetTodoListBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.executeInternalTool({
      name: 'get_todo_list',
      payload: body.workflow_run_id
        ? { workflow_run_id: body.workflow_run_id }
        : {},
      workflow_run_id: body.workflow_run_id,
      user: req.user,
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Replace the workflow run todo list and sync in-progress state.',
  })
  @Post('manage-todo-list')
  @RequirePermission('workflows:update')
  async manageTodoList(
    @Req() req: AuthenticatedRequest,
    @ZodBody(manageTodoListBodySchema) body: ManageTodoListBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.executeInternalTool({
      name: 'manage_todo_list',
      payload: body,
      workflow_run_id: body.workflow_run_id,
      user: req.user,
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'List active agent profiles available for delegation.',
  })
  @Post('get-agent-profiles')
  @RequirePermission('workflows:update')
  async getAgentProfiles(
    @ZodBody(getAgentProfilesBodySchema) body: GetAgentProfilesBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const params: GetAgentProfilesBody = {};
    if (body.limit !== undefined) params.limit = body.limit;
    if (body.offset !== undefined) params.offset = body.offset;
    if (body.include_inactive !== undefined) {
      params.include_inactive = body.include_inactive;
    }
    const data = await this.runtimeTools.getAgentProfiles(params);
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Fetch one active agent profile available for delegation.',
  })
  @Post('get-agent-profile')
  @RequirePermission('workflows:update')
  async getAgentProfile(
    @ZodBody(getAgentProfileBodySchema) body: GetAgentProfileBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.getAgentProfile(body.name);
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'List active agent profile names available for delegation.',
  })
  @Post('list-agent-profile-names')
  @RequirePermission('workflows:update')
  async listAgentProfileNames(
    @ZodBody(listAgentProfileNamesBodySchema)
    _body: ListAgentProfileNamesBody = {},
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.listAgentProfileNames();
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Launch a Core workflow for agent delegation.',
  })
  @Post('orchestration/invoke-agent-workflow')
  @RequirePermission('workflows:update')
  async invokeAgentWorkflow(
    @Req() req: AuthenticatedRequest,
    @ZodBody(invokeAgentWorkflowBodySchema) body: InvokeAgentWorkflowBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const agentContext = parseAgentExecutionContext(req.user?.userId);
    const workflowRunId = agentContext?.workflowRunId ?? body.workflow_run_id;
    const data = await this.orchestrationActions.invokeAgentWorkflow({
      ...body,
      ...(workflowRunId ? { workflow_run_id: workflowRunId } : {}),
    });
    return { success: true, data };
  }

  @ApiOperation({
    summary:
      'Launch one or more Core workflows and durably suspend the calling step until they complete.',
  })
  @Post('orchestration/await-agent-workflow')
  @RequirePermission('workflows:update')
  async awaitAgentWorkflow(
    @Req() req: AuthenticatedRequest,
    @ZodBody(awaitAgentWorkflowBodySchema) body: AwaitAgentWorkflowBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const agentContext = parseAgentExecutionContext(req.user?.userId);
    const workflowRunId = agentContext?.workflowRunId ?? body.workflow_run_id;
    const stepId = req.user?.stepId ?? body.step_id;
    const data = await this.awaitActions.startAwaitedInvocationWorkflows({
      ...body,
      ...(workflowRunId ? { workflow_run_id: workflowRunId } : {}),
      ...(stepId ? { step_id: stepId } : {}),
    });
    return { success: true, data: { ...data } };
  }

  @ApiOperation({
    summary:
      'List workflows still running for the current scope so an orchestrator can avoid re-spawning in-flight work.',
  })
  @Post('orchestration/list-running-workflows')
  @RequirePermission('workflows:update')
  async listRunningWorkflows(
    @Req() req: AuthenticatedRequest,
    @ZodBody(listRunningWorkflowsBodySchema) body: ListRunningWorkflowsBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const agentContext = parseAgentExecutionContext(req.user?.userId);
    const workflowRunId = agentContext?.workflowRunId ?? body.workflow_run_id;
    const data = await this.runningWorkflows.listRunningWorkflows({
      ...body,
      ...(workflowRunId ? { workflow_run_id: workflowRunId } : {}),
    });
    return { success: true, data: { ...data } };
  }

  @ApiOperation({
    summary: 'Finalize and persist orchestration session outcome.',
  })
  @Post('yield-session')
  @RequirePermission('workflows:update')
  yieldSession(@ZodBody(yieldSessionBodySchema) body: YieldSessionBody): {
    success: true;
    data: Record<string, unknown>;
  } {
    const data = this.orchestrationSession.yieldSession(body);
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'List directory contents for orchestration session context.',
  })
  @Post('list-path')
  @RequirePermission('workflows:update')
  async listPath(
    @ZodBody(listPathBodySchema) body: ListPathBody,
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.orchestrationSession.listPath(body);
    return { success: true, data };
  }

  @ApiOperation({
    summary: 'Apply a partial patch to orchestration session state.',
  })
  @Post('update-orchestration-state')
  @RequirePermission('workflows:update')
  updateOrchestrationState(
    @ZodBody(updateOrchestrationStateBodySchema)
    body: UpdateOrchestrationStateBody,
  ): { success: true; data: Record<string, unknown> } {
    const data = this.orchestrationSession.updateOrchestrationState(body);
    return { success: true, data };
  }

  @ApiOperation({
    summary:
      'Check whether a tool call is permitted under current runtime governance policy.',
  })
  @Post('check-permission')
  @RequirePermission('workflows:update')
  async checkPermission(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      tool_name: string;
      payload: Record<string, unknown>;
      workflow_run_id?: string;
      job_id?: string;
      chat_session_id?: string;
      scope_id?: string;
    },
  ): Promise<{ success: true; data: Record<string, unknown> }> {
    const data = await this.runtimeTools.checkPermission({
      tool_name: body.tool_name,
      payload: body.payload,
      workflow_run_id: body.workflow_run_id,
      job_id: body.job_id,
      chat_session_id: body.chat_session_id,
      scope_id: body.scope_id,
      user: req.user,
    });
    return { success: true, data };
  }
}
