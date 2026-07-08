import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventLedgerRepository } from '../../runtime/database/repositories/event-ledger.repository';
import { ExecutionRepository } from '../../execution-lifecycle/database/repositories/execution.repository';
import { SubagentDetailsRepository } from '../database/repositories/subagent-details.repository';
import { SubagentExecutionReadModel } from './subagent-execution-read-model';
import { ContainerOrchestratorService } from '../../docker/container-orchestrator.service';
import { RunnerConfigStoreService } from '../../redis/runner-config-store.service';
import { SkillMountingService } from '../../tool-runtime/skill-mounting.service';
import { ExecutionEventPublisher } from '../../execution-lifecycle/execution-event.publisher';
import { SubagentContainerLivenessProbe } from '../../execution-lifecycle/subagent-container-liveness.probe';
import { MeshDelegationService } from './mesh-delegation.service';
import { SubagentLifecycleEventService } from './subagent-lifecycle-event.service';
import { SubagentParentLockService } from './subagent-parent-lock.service';
import { SubagentParentResumeService } from './subagent-parent-resume.service';
import { SubagentProvisioningService } from './subagent-provisioning.service';
import {
  WORKFLOW_RUN_REPOSITORY_PORT,
  type IWorkflowRunRepository,
} from '../kernel/interfaces/workflow-kernel.ports';
import { mergeSdkNativeToolsForSubagent } from './subagent-tool-merge.helpers';
import {
  CHAT_SESSION_DOMAIN_PORT,
  CHAT_SESSION_REPOSITORY_PORT,
  type ChatSessionDomainPort,
  type IChatSessionRepositoryPort,
} from '../domain-ports';
import {
  checkSubagentStatusOperation,
  handleSubagentCompletionOperation,
} from './subagent-orchestrator.runtime.operations';
import {
  cancelSubagentExecutionByIdOperation,
  cancelSubagentExecutionOperation,
  emitWaitLifecycleEventOperation,
} from './subagent-orchestrator.coordination.operations';
import type { SubagentCoordinationOperationsContext } from './subagent-orchestrator.operations.types';
import type {
  SubagentStatusResult,
  WaitForSubagentsOptions,
  WaitForSubagentsResult,
} from './subagent-orchestrator.types';
import type { CancelledSubagentExecution } from '../workflow-interruption-recovery/interruption-recovery.types';
import { requireJwtSecret } from '../../config/jwt-runtime-config';
import {
  isTerminalSubagentStatus,
  normalizeStringList,
  waitForSubagentExecutions,
} from './subagent-orchestrator.utils';

/**
 * Owns runtime coordination of in-flight subagent executions: waiting,
 * status queries, cancellation, and completion handling.
 *
 * Consumed by `SubagentOrchestratorService` (the restored facade at
 * `apps/api/src/workflow/workflow-subagents/subagent-orchestrator.service.ts`),
 * which delegates the public lifecycle surface here, so the
 * lifecycle-management surface is decoupled from provisioning with only
 * the dependencies it actually consumes (SRP).
 */
@Injectable()
export class SubagentCoordinationService {
  private readonly logger = new Logger(SubagentCoordinationService.name);
  private readonly jwtSecret = requireJwtSecret();

  constructor(
    private readonly subagentDetailsRepo: SubagentDetailsRepository,
    private readonly subagentReadModel: SubagentExecutionReadModel,
    private readonly containerOrchestrator: ContainerOrchestratorService,
    private readonly runnerConfigStore: RunnerConfigStoreService,
    private readonly skillMounting: SkillMountingService,
    @Inject(CHAT_SESSION_DOMAIN_PORT)
    private readonly sessionHydration: ChatSessionDomainPort,
    @Inject(CHAT_SESSION_REPOSITORY_PORT)
    private readonly chatSessionRepo: IChatSessionRepositoryPort,
    private readonly meshDelegation: MeshDelegationService,
    private readonly parentResumeService: SubagentParentResumeService,
    private readonly lifecycleEvents: SubagentLifecycleEventService,
    private readonly parentLock: SubagentParentLockService,
    private readonly provisioning: SubagentProvisioningService,
    private readonly eventLedgerRepo: EventLedgerRepository,
    private readonly executionEventPublisher: ExecutionEventPublisher,
    @Inject(WORKFLOW_RUN_REPOSITORY_PORT)
    private readonly runRepo: IWorkflowRunRepository,
    private readonly executionRepo: ExecutionRepository,
    private readonly liveness: SubagentContainerLivenessProbe,
  ) {}

  async handleCompletion(
    executionId: string,
    result: Record<string, unknown>,
    workflowRunId?: string,
  ): Promise<void> {
    await handleSubagentCompletionOperation({
      logger: this.logger,
      executionId,
      workflowRunId,
      result,
      jwtSecret: this.jwtSecret,
      subagentDetailsRepo: this.subagentDetailsRepo,
      subagentReadModel: this.subagentReadModel,
      chatSessionRepo: this.chatSessionRepo,
      containerOrchestrator: this.containerOrchestrator,
      skillMounting: this.skillMounting,
      sessionHydration: this.sessionHydration,
      parentResumeService: this.parentResumeService,
      meshDelegation: this.meshDelegation,
      emitSubagentLifecycleEvent: (params) => this.lifecycleEvents.emit(params),
      spawnSubagentFromDelegation: async (request) => {
        const resolvedResumeSessionTreeId =
          await this.resolveResumeSessionTreeId({
            workflowRunId: request.workflowRunId,
            parentContainerId: request.parentContainerId,
            agentProfile: request.agentProfile,
            delegationContractId: request.contractId,
          });

        return this.provisioning.spawn(request.parentContainerId, {
          agent_profile: request.agentProfile,
          task_prompt: request.taskPrompt,
          tools: mergeSdkNativeToolsForSubagent(request.tools),
          tier: request.tier,
          workflowRunId: request.workflowRunId,
          lifecycle_stage: request.lifecycleStage,
          assigned_files: request.assignedFiles,
          delegation_contract_id: request.contractId,
          lineage_trace_id: request.traceId,
          lineage_parent_trace_id: request.parentTraceId,
          resumeSessionTreeId:
            resolvedResumeSessionTreeId ?? request.resumeSessionTreeId,
        });
      },
      clearRunnerConfig: (workflowRunIdArg, executionIdArg) =>
        this.runnerConfigStore.delete(workflowRunIdArg, executionIdArg),
      executionEvents: this.executionEventPublisher,
    });
  }

  async waitForSubagents(
    parentContainerId: string,
    options: WaitForSubagentsOptions = {},
  ): Promise<WaitForSubagentsResult> {
    this.logger.log(
      `Waiting for subagents of parent ${parentContainerId} to complete`,
    );

    await this.lifecycleEvents.emit({
      eventName: 'wait.requested',
      outcome: 'in_progress',
      parentContainerId,
      payload: {
        execution_ids: normalizeStringList(options.executionIds),
        timeout_seconds: options.timeoutSeconds,
      },
    });

    try {
      const result = await waitForSubagentExecutions({
        parentContainerId,
        options,
        findByParentContainerId: (id) =>
          this.subagentReadModel.findByParentContainerId(id),
      });

      await emitWaitLifecycleEventOperation(
        this.createCoordinationOperationsContext(),
        parentContainerId,
        result,
      );
      return result;
    } catch (error) {
      await this.lifecycleEvents.emit({
        eventName: 'wait.failed',
        outcome: 'failure',
        parentContainerId,
        payload: {
          execution_ids: normalizeStringList(options.executionIds),
          timeout_seconds: options.timeoutSeconds,
        },
        error,
      });
      throw error;
    }
  }

  async checkStatus(
    parentContainerId: string,
    executionId: string,
    workflowRunId?: string,
  ): Promise<SubagentStatusResult> {
    return checkSubagentStatusOperation({
      parentContainerId,
      executionId,
      workflowRunId,
      subagentReadModel: this.subagentReadModel,
      findLatestTurnForStep: (params) =>
        this.eventLedgerRepo.findLatestTurnForStep(params),
      emitSubagentLifecycleEvent: (params) => this.lifecycleEvents.emit(params),
    });
  }

  async cancelActiveForParent(
    parentContainerId: string,
    options: { workflowRunId?: string; reason?: string } = {},
  ): Promise<{ cancelled_execution_ids: string[] }> {
    return this.parentLock.runExclusive(parentContainerId, async () => {
      const executions =
        await this.subagentReadModel.findByParentContainerId(parentContainerId);
      const activeExecutions = executions.filter(
        (execution) => !isTerminalSubagentStatus(execution.status),
      );

      if (activeExecutions.length === 0) {
        return { cancelled_execution_ids: [] };
      }

      const cancelledExecutionIds: string[] = [];
      const cancelledAt = new Date();
      const reason = options.reason?.trim() || 'parent_abort';
      const context = this.createCoordinationOperationsContext();

      for (const execution of activeExecutions) {
        const cancelled = await cancelSubagentExecutionOperation(context, {
          parentContainerId,
          workflowRunId: options.workflowRunId,
          execution,
          reason,
          cancelledAt,
        });
        if (cancelled) {
          cancelledExecutionIds.push(execution.id);
          await this.meshDelegation.handleSubagentCancellation({
            subagentExecutionId: execution.id,
            reason,
          });
        }
      }

      return { cancelled_execution_ids: cancelledExecutionIds };
    });
  }

  async cancelExecution(
    parentContainerId: string,
    executionId: string,
    options: { workflowRunId?: string; reason?: string } = {},
  ): Promise<boolean> {
    return this.parentLock.runExclusive(parentContainerId, async () => {
      const reason = options.reason?.trim() || 'manual_cancel';
      const cancelledExecution = await cancelSubagentExecutionByIdOperation(
        this.createCoordinationOperationsContext(),
        {
          parentContainerId,
          workflowRunId: options.workflowRunId,
          executionId,
          reason,
          cancelledAt: new Date(),
        },
      );

      if (!cancelledExecution) {
        return false;
      }

      await this.meshDelegation.handleSubagentCancellation({
        subagentExecutionId: cancelledExecution.id,
        reason,
      });

      return true;
    });
  }

  private async resolveResumeSessionTreeId(params: {
    workflowRunId?: string;
    parentContainerId: string;
    agentProfile: string;
    delegationContractId: string;
  }): Promise<string | undefined> {
    const {
      workflowRunId,
      parentContainerId,
      agentProfile,
      delegationContractId,
    } = params;

    if (!workflowRunId || !delegationContractId) {
      return undefined;
    }

    let parentJobId: string | undefined;

    try {
      const parentExecution =
        await this.executionRepo.findByContainerId(parentContainerId);
      if (parentExecution?.context_id) {
        parentJobId = parentExecution.context_id;
      }
    } catch (error) {
      this.logger.warn(
        `Failed to look up parent execution for container ${parentContainerId}: ${(error as Error).message}`,
        { workflowRunId, parentContainerId, error },
      );
      return undefined;
    }

    if (!parentJobId) {
      return undefined;
    }

    const stateKey = `_internal.${parentJobId}.cancelled_subagent_resumes`;

    try {
      const run = await this.runRepo.findById(workflowRunId);
      if (!run?.state_variables) {
        return undefined;
      }

      const found = this.findCancelledSubagentResume(
        run.state_variables,
        parentJobId,
        agentProfile,
        delegationContractId,
      );
      if (!found) {
        return undefined;
      }

      const [matched] = found.resumes.splice(found.matchIndex, 1);

      await this.runRepo.setStateVariableAtomic(
        workflowRunId,
        stateKey,
        found.resumes.length > 0 ? found.resumes : [],
      );

      return matched.sessionTreeId;
    } catch (error) {
      this.logger.warn(
        `Failed to read/clear cancelled subagent resume refs for run ${workflowRunId}, job ${parentJobId}, profile ${agentProfile}, contract ${delegationContractId}: ${(error as Error).message}`,
        {
          workflowRunId,
          parentJobId,
          agentProfile,
          delegationContractId,
          error,
        },
      );
      return undefined;
    }
  }

  private findCancelledSubagentResume(
    stateVariables: Record<string, unknown>,
    parentJobId: string,
    agentProfile: string,
    delegationContractId: string,
  ): { resumes: CancelledSubagentExecution[]; matchIndex: number } | undefined {
    const internalSection = stateVariables._internal as
      | Record<string, unknown>
      | undefined;
    if (!internalSection) {
      return undefined;
    }

    const jobSection = internalSection[parentJobId] as
      | Record<string, unknown>
      | undefined;
    if (!jobSection) {
      return undefined;
    }

    const resumes = jobSection.cancelled_subagent_resumes as
      | CancelledSubagentExecution[]
      | undefined;
    if (!Array.isArray(resumes) || resumes.length === 0) {
      return undefined;
    }

    const matchIndex = resumes.findIndex(
      (entry) =>
        entry.agentProfileName === agentProfile &&
        entry.contractId === delegationContractId,
    );
    if (matchIndex === -1) {
      return undefined;
    }

    return { resumes, matchIndex };
  }

  private createCoordinationOperationsContext(): SubagentCoordinationOperationsContext {
    return {
      subagentDetailsRepo: this.subagentDetailsRepo,
      subagentReadModel: this.subagentReadModel,
      chatSessionRepo: this.chatSessionRepo,
      containerOrchestrator: this.containerOrchestrator,
      skillMounting: this.skillMounting,
      emitSubagentLifecycleEvent: (params) => this.lifecycleEvents.emit(params),
      executionEvents: this.executionEventPublisher,
      liveness: this.liveness,
      logger: this.logger,
    };
  }
}
