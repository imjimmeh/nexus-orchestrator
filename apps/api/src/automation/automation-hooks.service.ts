import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AutomationHookTriggerType } from '@nexus/core';
import { AutomationHook } from './database/entities/automation-hook.entity';
import type { Workflow } from '../workflow/database/entities/workflow.entity';
import { AutomationHookRepository } from './database/repositories/automation-hook.repository';
import { EventLedgerService } from '../observability/event-ledger.service';
import {
  WORKFLOW_DEFINITION_REPOSITORY_PORT,
  WORKFLOW_ENGINE_SERVICE,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';
import type {
  IWorkflowDefinitionRepository,
  IWorkflowEngineService,
} from '../workflow/kernel/interfaces/workflow-kernel.ports';
import {
  emitHookCooldownSkippedAudit,
  emitHookDispatchFailedAudit,
  emitHookDispatchSkippedAudit,
  emitHookDispatchSucceededAudit,
} from './automation-hooks.audit';
import {
  executeHookAction,
  validateHookActionPayload,
} from './automation-hooks.action';
import {
  isWithinCooldownWindow,
  matchesTriggerFilter,
} from './automation-hooks.utils';
import type {
  AutomationHookListFilters,
  AutomationPagination,
  CreateAutomationHookParams,
  HookDispatchResult,
  ListAutomationHooksResult,
  UpdateAutomationHookParams,
} from './automation-hooks.types';
import { toAutomationHookSummary } from './automation-hooks.view';

type HookDispatchOutcome = 'fired' | 'skipped' | 'failed';

@Injectable()
export class AutomationHooksService {
  constructor(
    @Inject(WORKFLOW_DEFINITION_REPOSITORY_PORT)
    private readonly workflowRepository: IWorkflowDefinitionRepository,
    private readonly automationHookRepository: AutomationHookRepository,
    @Inject(WORKFLOW_ENGINE_SERVICE)
    private readonly workflowEngineService: IWorkflowEngineService,
    private readonly eventEmitter: EventEmitter2,
    private readonly eventLedger: EventLedgerService,
  ) {}

  async listHooks(
    filters: AutomationHookListFilters,
    pagination: AutomationPagination,
  ): Promise<ListAutomationHooksResult> {
    const { data, total } = await this.automationHookRepository.findAll({
      scopeId: filters.scopeId,
      triggerType: filters.triggerType,
      limit: pagination.limit,
      offset: pagination.offset,
    });

    return {
      items: data.map((hook) => toAutomationHookSummary(hook)),
      total,
      limit: pagination.limit,
      offset: pagination.offset,
    };
  }

  async getHook(id: string) {
    const hook = await this.requireHook(id);
    return toAutomationHookSummary(hook);
  }

  async createHook(params: CreateAutomationHookParams) {
    await validateHookActionPayload({
      actionType: params.action_type,
      actionPayload: params.action_payload,
      ensureWorkflowExists: (workflowId) =>
        this.ensureWorkflowExists(workflowId),
    });

    const created = await this.automationHookRepository.create({
      scopeId: params.scopeId,
      enabled: params.enabled ?? true,
      trigger_type: params.trigger_type,
      trigger_filter: params.trigger_filter ?? null,
      priority: params.priority ?? 100,
      action_type: params.action_type,
      action_payload: params.action_payload,
      cooldown_window_seconds: params.cooldown_window_seconds ?? 0,
      created_by: params.created_by ?? null,
      updated_by: params.created_by ?? null,
    });

    return toAutomationHookSummary(created);
  }

  async updateHook(id: string, params: UpdateAutomationHookParams) {
    const existing = await this.requireHook(id);

    const actionType = params.action_type ?? existing.action_type;
    const actionPayload = params.action_payload ?? existing.action_payload;
    await validateHookActionPayload({
      actionType,
      actionPayload,
      ensureWorkflowExists: (workflowId) =>
        this.ensureWorkflowExists(workflowId),
    });

    const updated = await this.automationHookRepository.update(id, {
      enabled: params.enabled ?? existing.enabled,
      trigger_type: params.trigger_type ?? existing.trigger_type,
      trigger_filter: params.trigger_filter ?? existing.trigger_filter,
      priority: params.priority ?? existing.priority,
      action_type: actionType,
      action_payload: actionPayload,
      cooldown_window_seconds:
        params.cooldown_window_seconds ?? existing.cooldown_window_seconds,
      updated_by: params.updated_by ?? existing.updated_by,
    });

    if (!updated) {
      throw new NotFoundException(`Automation hook ${id} not found`);
    }

    return toAutomationHookSummary(updated);
  }

  async deleteHook(id: string): Promise<void> {
    await this.requireHook(id);
    await this.automationHookRepository.remove(id);
  }

  async dispatchHooks(params: {
    triggerType: AutomationHookTriggerType;
    scopeId: string;
    payload: Record<string, unknown>;
  }): Promise<HookDispatchResult> {
    const hooks =
      await this.automationHookRepository.findEnabledByScopeIdAndTrigger(
        params.scopeId,
        params.triggerType,
      );

    let fired = 0;
    let skipped = 0;
    let failed = 0;
    const now = new Date();

    for (const hook of hooks) {
      const outcome = await this.dispatchSingleHook({
        hook,
        triggerType: params.triggerType,
        payload: params.payload,
        now,
      });

      if (outcome === 'fired') {
        fired++;
      } else if (outcome === 'skipped') {
        skipped++;
      } else {
        failed++;
      }
    }

    return {
      trigger_type: params.triggerType,
      scopeId: params.scopeId,
      total: hooks.length,
      fired,
      skipped,
      failed,
    };
  }

  private async dispatchSingleHook(params: {
    hook: AutomationHook;
    triggerType: AutomationHookTriggerType;
    payload: Record<string, unknown>;
    now: Date;
  }): Promise<HookDispatchOutcome> {
    if (!matchesTriggerFilter(params.hook.trigger_filter, params.payload)) {
      return 'skipped';
    }

    if (isWithinCooldownWindow(params.hook, params.now)) {
      await emitHookCooldownSkippedAudit(this.eventLedger, params.hook);
      return 'skipped';
    }

    try {
      const actionResult = await executeHookAction({
        hook: params.hook,
        triggerType: params.triggerType,
        payload: params.payload,
        resolveWorkflowId: (workflowId) => this.resolveWorkflowId(workflowId),
        startWorkflow: (workflowId, triggerData) =>
          this.workflowEngineService.startWorkflow(workflowId, triggerData),
        emitEvent: (eventName, payload) => {
          this.eventEmitter.emit(eventName, payload);
        },
      });
      await this.automationHookRepository.setLastFiredAt(
        params.hook.id,
        params.now,
      );

      if (actionResult.status === 'fired') {
        await emitHookDispatchSucceededAudit(this.eventLedger, params.hook, {
          workflowRunId: actionResult.workflowRunId,
          message: actionResult.message,
        });
        return 'fired';
      }

      await emitHookDispatchSkippedAudit(
        this.eventLedger,
        params.hook,
        actionResult.message,
      );
      return 'skipped';
    } catch (error) {
      await emitHookDispatchFailedAudit(
        this.eventLedger,
        params.hook,
        (error as Error).message,
      );
      return 'failed';
    }
  }

  private async requireHook(id: string): Promise<AutomationHook> {
    const hook = await this.automationHookRepository.findById(id);
    if (!hook) {
      throw new NotFoundException(`Automation hook ${id} not found`);
    }

    return hook;
  }

  private async ensureWorkflowExists(workflowId: string): Promise<void> {
    const workflow: Workflow | null =
      await this.workflowRepository.findByIdentifier(workflowId, {
        includeInactive: true,
      });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    if (!workflow.is_active) {
      throw new BadRequestException(
        `Workflow ${workflowId} is inactive and cannot be invoked by hook`,
      );
    }
  }

  private async resolveWorkflowId(workflowId: string): Promise<string> {
    const workflow: Workflow | null =
      await this.workflowRepository.findByIdentifier(workflowId, {
        includeInactive: true,
      });
    if (!workflow) {
      throw new NotFoundException(`Workflow ${workflowId} not found`);
    }

    if (!workflow.is_active) {
      throw new BadRequestException(
        `Workflow ${workflowId} is inactive and cannot be invoked by hook`,
      );
    }

    return workflow.id;
  }
}
