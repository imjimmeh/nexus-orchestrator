import { Injectable, Inject, NotFoundException, Logger } from '@nestjs/common';
import { normalizeOptionalString } from '@nexus/core';
import type { IWorkflow, IWorkflowDefinition } from '@nexus/core';
import { BudgetDecisionService } from '../../cost-governance/budget-decision.service';
import { WorkflowLaunchPresetRepository } from '../database/repositories/workflow-launch-preset.repository';
import { EventLedgerService } from '../../observability/event-ledger.service';
import {
  ExecuteWorkflowDto,
  WorkflowLaunchContextQueryDto,
} from '../workflow.controller.dto';
import { WorkflowLaunchContractService } from './workflow-launch-contract.service';
import {
  WORKFLOW_ENGINE_SERVICE,
  WORKFLOW_PERSISTENCE_SERVICE,
  WORKFLOW_PARSER_SERVICE,
} from '../kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowEngineService,
  IWorkflowPersistenceService,
  IWorkflowParserService,
} from '../kernel/interfaces/workflow-kernel.ports';
import type {
  WorkflowLaunchContext,
  WorkflowLaunchDescriptor,
  WorkflowLaunchSource,
} from '@nexus/core';
import {
  buildLaunchValidationException,
  buildWorkflowLaunchDescriptor,
  normalizeRecord,
} from './workflow-launch-orchestration.helpers';

@Injectable()
export class WorkflowLaunchOrchestrationService {
  private readonly logger = new Logger(WorkflowLaunchOrchestrationService.name);

  constructor(
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngine: IWorkflowEngineService,
    @Inject(WORKFLOW_PERSISTENCE_SERVICE)
    private readonly workflowPersistence: IWorkflowPersistenceService,
    @Inject(WORKFLOW_PARSER_SERVICE)
    private readonly workflowParser: IWorkflowParserService,
    private readonly workflowLaunchContracts: WorkflowLaunchContractService,
    private readonly workflowLaunchPresets: WorkflowLaunchPresetRepository,
    private readonly eventLedger: EventLedgerService,
    private readonly budgetDecisionService: BudgetDecisionService,
  ) {}

  resolveLaunchContext(
    query: WorkflowLaunchContextQueryDto,
  ): WorkflowLaunchContext {
    return {
      scopeId: normalizeOptionalString(query.scopeId),
      contextId: normalizeOptionalString(query.contextId),
    };
  }

  buildWorkflowLaunchDescriptor(
    workflow: IWorkflow,
    context: WorkflowLaunchContext,
  ): WorkflowLaunchDescriptor | null {
    return buildWorkflowLaunchDescriptor({
      workflow,
      context,
      parseWorkflow: (yamlDefinition) =>
        this.workflowParser.parseWorkflow(yamlDefinition),
      buildContract: (definition) =>
        this.workflowLaunchContracts.buildContract(
          definition as IWorkflowDefinition,
        ),
      evaluateEligibility: (contract, launchContext) =>
        this.workflowLaunchContracts.evaluateEligibility(
          contract,
          launchContext,
        ),
    });
  }

  private async checkLaunchBudget(
    runId: string,
    providerName: string | null,
    modelName: string | null,
  ): Promise<void> {
    try {
      const result = await this.budgetDecisionService.evaluateAction({
        scopeId: null,
        contextType: 'workflow_run',
        contextId: runId,
        actionType: 'workflow_launch',
        actorType: 'workflow',
        actorId: null,
        providerName,
        modelName,
        expectedTokens: null,
        correlationId: runId,
      });
      if (result?.decision === 'deny') {
        throw new Error(
          `Workflow launch blocked by budget policy: ${result.reasonCode}`,
        );
      }
    } catch (err) {
      if (
        err instanceof Error &&
        err.message.includes('blocked by budget policy')
      ) {
        throw err;
      }
    }
  }

  async executeWorkflowInternal(params: {
    workflowId: string;
    executeDto: ExecuteWorkflowDto;
    defaultLaunchSource: WorkflowLaunchSource;
  }): Promise<{ success: true; data: Record<string, unknown> }> {
    const launchPayload = await this.resolveValidatedExecutePayload(params);
    const isDryRun = params.executeDto.dry_run === true;

    if (!isDryRun) {
      await this.checkLaunchBudget(params.workflowId, null, null);
    }

    const result = isDryRun
      ? await this.workflowEngine.startWorkflow(
          params.workflowId,
          launchPayload.triggerData,
          {
            dryRun: true,
          },
        )
      : await this.workflowEngine.startWorkflow(
          params.workflowId,
          launchPayload.triggerData,
        );

    const runId = typeof result === 'string' ? result : null;

    await this.emitLaunchLifecycleEvent({
      eventName: 'launch_executed',
      outcome: isDryRun ? 'success' : 'in_progress',
      workflowRowId: launchPayload.workflow.id,
      workflowDefinitionId: launchPayload.workflowDefinitionId,
      launchSource: launchPayload.launchSource,
      scopeId: launchPayload.scopeId,
      contextId: launchPayload.contextId,
      runId,
      presetId: launchPayload.presetId,
      payload: {
        dryRun: isDryRun,
      },
    });

    if (isDryRun) {
      return {
        success: true,
        data: result as unknown as Record<string, unknown>,
      };
    }

    return {
      success: true,
      data: {
        runId,
      },
    };
  }

  private async emitLaunchLifecycleEvent(params: {
    eventName:
      | 'launch_requested'
      | 'launch_validated'
      | 'launch_rejected'
      | 'launch_executed';
    outcome: 'success' | 'failure' | 'denied' | 'in_progress';
    workflowRowId: string;
    workflowDefinitionId: string;
    launchSource: WorkflowLaunchSource;
    scopeId?: string | null;
    contextId?: string | null;
    runId?: string | null;
    presetId?: string | null;
    payload?: Record<string, unknown>;
    errorCode?: string;
    errorMessage?: string;
  }): Promise<void> {
    const payload: Record<string, unknown> = {
      workflowDefinitionId: params.workflowDefinitionId,
      launchSource: params.launchSource,
    };

    if (params.presetId) {
      payload.presetId = params.presetId;
    }

    if (params.payload) {
      Object.assign(payload, params.payload);
    }

    await this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: params.eventName,
      outcome: params.outcome,
      workflowId: params.workflowRowId,
      workflowRunId: normalizeOptionalString(params.runId) ?? undefined,
      context: {
        scopeId: normalizeOptionalString(params.scopeId) ?? null,
        contextId: normalizeOptionalString(params.contextId) ?? null,
        contextType: normalizeOptionalString(params.contextId)
          ? 'resource'
          : null,
        scopeNodeId: null,
        scopePath: null,
      },
      payload,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    });
  }

  private async resolvePresetLaunchData(params: {
    workflowId: string;
    presetId: string | null;
  }): Promise<{
    presetTriggerData: Record<string, unknown>;
  }> {
    if (!params.presetId) {
      return {
        presetTriggerData: {},
      };
    }

    const preset = await this.workflowLaunchPresets.findByIdAndWorkflow(
      params.presetId,
      params.workflowId,
    );
    if (!preset) {
      throw new NotFoundException(
        `Launch preset ${params.presetId} not found for workflow ${params.workflowId}`,
      );
    }

    return {
      presetTriggerData: normalizeRecord(preset.trigger_data),
    };
  }

  private async validateLaunchPayloadOrThrow(params: {
    workflowRowId: string;
    workflowDefinitionId: string;
    launchSource: WorkflowLaunchSource;
    presetId: string | null;
    scopeId: string | null;
    contextId: string | null;
    contract: ReturnType<WorkflowLaunchContractService['buildContract']>;
    triggerData: Record<string, unknown>;
  }) {
    const validation = this.workflowLaunchContracts.validateLaunchPayload({
      contract: params.contract,
      triggerData: params.triggerData,
      context: {
        scopeId: params.scopeId,
        contextId: params.contextId,
      },
    });

    if (validation.valid) {
      return validation;
    }

    await this.emitLaunchLifecycleEvent({
      eventName: 'launch_rejected',
      outcome: 'denied',
      workflowRowId: params.workflowRowId,
      workflowDefinitionId: params.workflowDefinitionId,
      launchSource: params.launchSource,
      scopeId: params.scopeId,
      contextId: params.contextId,
      presetId: params.presetId,
      payload: {
        issues: validation.issues,
      },
      errorCode: 'WORKFLOW_LAUNCH_VALIDATION_FAILED',
      errorMessage: validation.issues[0]?.message,
    });

    throw buildLaunchValidationException(validation.issues);
  }

  private async resolveValidatedExecutePayload(params: {
    workflowId: string;
    executeDto: ExecuteWorkflowDto;
    forcedScopeId?: string;
    defaultLaunchSource: WorkflowLaunchSource;
  }): Promise<{
    workflow: IWorkflow;
    workflowDefinitionId: string;
    workflowName: string;
    launchSource: WorkflowLaunchSource;
    presetId: string | null;
    triggerData: Record<string, unknown>;
    scopeId: string | null;
    contextId: string | null;
  }> {
    const workflow = await this.workflowPersistence.getWorkflow(
      params.workflowId,
    );
    const definition = this.workflowParser.parseWorkflow(
      workflow.yaml_definition,
    );
    const contract = this.workflowLaunchContracts.buildContract(definition);

    const presetId = normalizeOptionalString(params.executeDto.preset_id);
    const { presetTriggerData } = await this.resolvePresetLaunchData({
      workflowId: params.workflowId,
      presetId,
    });

    const launchSource =
      params.executeDto.launch_source ??
      (presetId ? 'preset' : params.defaultLaunchSource);
    const triggerData = {
      ...presetTriggerData,
      ...normalizeRecord(params.executeDto.trigger_data),
    };

    await this.emitLaunchLifecycleEvent({
      eventName: 'launch_requested',
      outcome: 'in_progress',
      workflowRowId: workflow.id,
      workflowDefinitionId: definition.workflow_id,
      launchSource,
      scopeId: null,
      contextId: null,
      presetId,
      payload: {
        dryRun: params.executeDto.dry_run === true,
      },
    });

    const validation = await this.validateLaunchPayloadOrThrow({
      workflowRowId: workflow.id,
      workflowDefinitionId: definition.workflow_id,
      launchSource,
      presetId,
      scopeId: null,
      contextId: null,
      contract,
      triggerData,
    });

    validation.normalizedTriggerData._launch = {
      ...normalizeRecord(validation.normalizedTriggerData._launch),
      source: launchSource,
      presetId,
      workflowDefinitionId: definition.workflow_id,
      requestedAt: new Date().toISOString(),
      dryRun: params.executeDto.dry_run === true,
    };

    await this.emitLaunchLifecycleEvent({
      eventName: 'launch_validated',
      outcome: 'success',
      workflowRowId: workflow.id,
      workflowDefinitionId: definition.workflow_id,
      launchSource,
      scopeId: validation.normalizedContext.scopeId ?? null,
      contextId: validation.normalizedContext.contextId ?? null,
      presetId,
    });

    return {
      workflow,
      workflowDefinitionId: definition.workflow_id,
      workflowName: definition.name,
      launchSource,
      presetId,
      triggerData: validation.normalizedTriggerData,
      scopeId: validation.normalizedContext.scopeId ?? null,
      contextId: validation.normalizedContext.contextId ?? null,
    };
  }
}
