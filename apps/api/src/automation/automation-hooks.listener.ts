import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AutomationHookTriggerType } from '@nexus/core';
import {
  WORKFLOW_RUN_STARTED_EVENT,
  WORKFLOW_RUN_FAILED_EVENT,
} from '../workflow/workflow-events.constants';
import type { WorkflowRunEvent } from '../workflow/workflow-events.types';
import { AutomationHooksService } from './automation-hooks.service';

@Injectable()
export class AutomationHooksListener {
  private readonly logger = new Logger(AutomationHooksListener.name);

  constructor(
    private readonly automationHooksService: AutomationHooksService,
  ) {}

  @OnEvent(WORKFLOW_RUN_STARTED_EVENT)
  async onWorkflowRunStarted(event: WorkflowRunEvent): Promise<void> {
    const scopeId = this.resolveScopeId(event.stateVariables);
    if (!scopeId) {
      return;
    }

    await this.dispatchSafely(
      `workflow_run:${event.workflowRunId}:${event.status}`,
      {
        triggerType: AutomationHookTriggerType.WORKFLOW_RUN_STARTED,
        scopeId,
        payload: {
          workflow_run_id: event.workflowRunId,
          status: event.status,
          state_variables: event.stateVariables,
        },
      },
    );
  }

  @OnEvent(WORKFLOW_RUN_FAILED_EVENT)
  async onWorkflowRunFailed(event: WorkflowRunEvent): Promise<void> {
    const scopeId = this.resolveScopeId(event.stateVariables);
    if (!scopeId) {
      return;
    }

    await this.dispatchSafely(
      `workflow_run:${event.workflowRunId}:${event.status}`,
      {
        triggerType: AutomationHookTriggerType.WORKFLOW_RUN_FAILED,
        scopeId,
        payload: {
          workflow_run_id: event.workflowRunId,
          workflow_id: event.workflowId,
          status: event.status,
          failure_reason: event.reason ?? null,
          trigger_data: event.triggerData ?? null,
          state_variables: event.stateVariables,
        },
      },
    );
  }

  private resolveScopeId(
    stateVariables: Record<string, unknown>,
  ): string | null {
    const trigger = this.asRecord(stateVariables.trigger);
    if (!trigger) {
      return null;
    }

    const fromScopeId = trigger.scopeId;
    if (typeof fromScopeId === 'string' && fromScopeId.trim().length > 0) {
      return fromScopeId.trim();
    }

    return null;
  }

  private async dispatchSafely(
    source: string,
    params: {
      triggerType: AutomationHookTriggerType;
      scopeId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    try {
      await this.automationHooksService.dispatchHooks(params);
    } catch (error) {
      this.logger.warn(
        `Failed to dispatch automation hooks for ${source}: ${(error as Error).message}`,
      );
    }
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }
}
