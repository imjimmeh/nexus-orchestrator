import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Inject,
  InternalServerErrorException,
  Logger,
  Optional,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import Docker from 'dockerode';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/authorization/permissions.guard';
import { RequirePermission } from '../../auth/authorization/require-permission.decorator';
import { DOCKER_CLIENT } from '../../docker/docker.constants';
import { AgentResponseStoreService } from '../../redis/agent-response-store.service';
import { RedisPubSubService } from '../../redis/redis-pubsub.service';
import { RedisStreamService } from '../../redis/redis-stream.service';
import { SubagentExecutionReadModel } from '../workflow-subagents/subagent-execution-read-model';
import { isTerminalSubagentStatus } from '../workflow-subagents/subagent-orchestrator.utils';
import { ToolContractRepairAdapter } from '../../tool-runtime/tool-contract-repair.adapter';
import { stepCompleteInputSchema } from '../providers/workflow-completion-capability.provider';
import { WorkflowStepCompletionGuardService } from '../workflow-step-completion-guard.service';
import { WorkflowRuntimeTerminalRunGuardService } from './workflow-runtime-terminal-run-guard.service';
import type { AuthenticatedRequest } from './workflow-runtime-tools.controller.types';
import { parseAgentExecutionContext } from './workflow-runtime-tools.context';

/**
 * Authorization migration traceability
 * ------------------------------------
 * Migrated from the legacy role-based guard class to
 * `PermissionsGuard` + `RequirePermission`.
 *
 * Source cluster: `workflow-runtime/step-complete` (agent runtime
 * traffic).
 * Source role set: `Admin` / `Developer` / `Agent`.
 *
 * Per-handler role-list -> RequirePermission mapping:
 *   - stepComplete         Admin / Developer / Agent -> workflows:update
 *
 * Notes:
 *   - `step_complete` finalizes the current agent step, which is a
 *     workflow-run state transition. It maps to `workflows:update`,
 *     which is in the agent's documented permission set.
 */

interface StepCompleteBody extends Record<string, unknown> {
  summary?: string;
  reasoning?: string;
  status?: string;
}

const EMPTY_STEP_COMPLETE_RESPONSE = '__STEP_COMPLETE_WITHOUT_SUMMARY__';

@ApiTags('workflow-runtime-tools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('workflow-runtime')
export class WorkflowRuntimeStepCompleteController {
  private readonly logger = new Logger(
    WorkflowRuntimeStepCompleteController.name,
  );

  constructor(
    private readonly streamService: RedisStreamService,
    private readonly pubsubService: RedisPubSubService,
    private readonly agentResponseStore: AgentResponseStoreService,
    @Optional()
    private readonly toolContractRepair?: ToolContractRepairAdapter,
    @Optional()
    private readonly stepCompletionGuard?: WorkflowStepCompletionGuardService,
    @Optional()
    private readonly terminalRunGuard?: WorkflowRuntimeTerminalRunGuardService,
    private readonly subagentReadModel?: SubagentExecutionReadModel,
    @Inject(DOCKER_CLIENT) private readonly docker?: Docker,
  ) {}

  @ApiOperation({ summary: 'Signal completion of the current agent step.' })
  @Post('step-complete')
  @RequirePermission('workflows:update')
  async stepComplete(
    @Req() req: AuthenticatedRequest,
    @Body() rawBody: StepCompleteBody,
  ) {
    const body = await this.repairAndValidateStepCompleteBody(
      rawBody,
      req.user?.userId,
    );
    const agentContext = parseAgentExecutionContext(req.user?.userId);
    if (!agentContext?.workflowRunId || !req.user?.stepId) {
      throw new BadRequestException('Agent step context is required');
    }

    const terminalDenial = await this.rejectTerminalStepCompleteIfNeeded({
      workflowRunId: agentContext.workflowRunId,
      jobId: req.user.jobId,
      stepId: req.user.stepId,
      body,
    });
    if (terminalDenial) {
      return terminalDenial;
    }

    const validationDenial = await this.validateStepCompletionIfNeeded(
      req,
      agentContext,
      body,
    );
    if (validationDenial) {
      return validationDenial;
    }

    await this.persistRuntimeEvent(agentContext.workflowRunId, {
      event_type: 'step_complete',
      payload: body,
    });
    await this.agentResponseStore.storeStepComplete(
      agentContext.workflowRunId,
      req.user.stepId,
      body.summary?.trim() || EMPTY_STEP_COMPLETE_RESPONSE,
    );

    // `executionStatus: 'completed'` is a terminate directive: the step is now
    // finalized, so the runner must end the agent's turn instead of looping on
    // more tool calls (re-spawning subagents, re-calling step_complete). The
    // api-callback layer reads it and sets `terminate: true`.
    return { success: true, ok: true, executionStatus: 'completed' };
  }

  private async validateStepCompletionIfNeeded(
    req: AuthenticatedRequest,
    agentContext: { workflowRunId: string },
    body: StepCompleteBody,
  ): Promise<{
    success: boolean;
    ok: boolean;
    error: string;
    missing_fields?: string[];
    remediation_prompt?: string;
  } | null> {
    const user = req.user;
    if (!user?.jobId || !user?.stepId) {
      return null;
    }
    const { jobId, stepId } = user;

    const activeSubagentDenial = await this.rejectIfActiveSubagents({
      workflowRunId: agentContext.workflowRunId,
      jobId,
      stepId,
      body,
    });
    if (activeSubagentDenial) {
      return activeSubagentDenial;
    }

    const stepCompletionGuard = this.stepCompletionGuard;
    if (!stepCompletionGuard) {
      throw new InternalServerErrorException(
        'Step completion guard is unavailable',
      );
    }

    const validation = await stepCompletionGuard.validateStepCompletion({
      workflowRunId: agentContext.workflowRunId,
      jobId,
    });
    if (!validation.allowed) {
      const feedback = validation.feedback ?? 'Step completion denied';
      await this.persistRuntimeEvent(agentContext.workflowRunId, {
        event_type: 'step_complete_denied',
        payload: {
          ...body,
          error: feedback,
          missing_fields: validation.missing,
        },
      });
      return {
        success: false,
        ok: false,
        error: feedback,
        missing_fields: validation.missing,
        remediation_prompt: feedback,
      };
    }

    return null;
  }

  private async rejectIfActiveSubagents(params: {
    workflowRunId: string;
    jobId: string;
    stepId: string;
    body: StepCompleteBody;
  }): Promise<{ success: false; ok: false; error: string } | null> {
    if (!this.docker || !this.subagentReadModel) {
      return null;
    }

    try {
      const containers = await this.docker.listContainers({
        all: false,
        filters: {
          label: [
            'nexus.managed=true',
            `nexus.workflow_run_id=${params.workflowRunId}`,
            `nexus.job_id=${params.jobId}`,
            `nexus.step_id=${params.stepId}`,
          ],
          status: ['running'],
        },
      });

      if (containers.length === 0) {
        return null;
      }

      const parentContainerId = containers[0].Id;
      const executions =
        await this.subagentReadModel.findByParentContainerId(parentContainerId);
      const activeExecutions = executions.filter(
        (execution) => !isTerminalSubagentStatus(execution.status),
      );

      if (activeExecutions.length === 0) {
        return null;
      }

      const activeIds = activeExecutions.map((e) => e.id).join(', ');
      await this.persistRuntimeEvent(params.workflowRunId, {
        event_type: 'step_complete_denied',
        payload: {
          ...params.body,
          error: 'Active subagents still running',
          active_subagent_ids: activeExecutions.map((e) => e.id),
        },
      });

      return {
        success: false,
        ok: false,
        error: `Active subagents still running (${activeIds}). Call wait_for_subagents to await completion before step_complete.`,
      };
    } catch (error) {
      this.logger.warn(
        `Failed to check active subagents before step_complete: ${error}`,
      );
      return null;
    }
  }

  private async rejectTerminalStepCompleteIfNeeded(params: {
    workflowRunId: string;
    jobId?: string;
    stepId: string;
    body: StepCompleteBody;
  }): Promise<{
    success: false;
    ok: false;
    error: string;
    executionStatus: 'terminated';
  } | null> {
    if (!this.terminalRunGuard) {
      return null;
    }

    try {
      await this.terminalRunGuard.assertRunIsActive(params.workflowRunId, {
        action: 'step_complete',
        jobId: params.jobId,
        stepId: params.stepId,
      });
      return null;
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }
      await this.persistRuntimeEvent(params.workflowRunId, {
        event_type: 'step_complete_denied',
        payload: {
          ...params.body,
          error: error.message,
          reason: 'terminal_workflow_run',
        },
      });
      // `executionStatus: 'terminated'` is a terminate directive — the run is
      // terminal, so the runner must abort the agent turn rather than retrying.
      return {
        success: false,
        ok: false,
        error: error.message,
        executionStatus: 'terminated',
      };
    }
  }

  private async persistRuntimeEvent(
    workflowRunId: string,
    event: { event_type: string; payload: Record<string, unknown> },
  ): Promise<void> {
    const fullEvent = { ...event, timestamp: new Date().toISOString() };
    await this.streamService.persistEvent(workflowRunId, fullEvent);
    await this.pubsubService.publishEvent(workflowRunId, fullEvent);
  }

  private async repairAndValidateStepCompleteBody(
    rawBody: StepCompleteBody,
    userId?: string,
  ): Promise<StepCompleteBody> {
    let payload: Record<string, unknown> = { ...rawBody };

    if (this.toolContractRepair) {
      const agentContext = parseAgentExecutionContext(userId);
      const repairResult = await this.toolContractRepair.repair({
        toolName: 'step_complete',
        payload,
        workflowRunId: agentContext?.workflowRunId,
        jobId: agentContext?.jobId,
      });
      payload = repairResult.payload;
    }

    const parsed = stepCompleteInputSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BadRequestException(
        'Unexpected extra fields in step completion',
      );
    }

    return parsed.data;
  }
}
