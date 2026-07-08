import { BadRequestException } from '@nestjs/common';
import {
  AutomationHookActionType,
  AutomationHookTriggerType,
} from '@nexus/core';
import { AutomationHook } from './database/entities/automation-hook.entity';
import {
  readObjectFromPayload,
  readStringFromPayload,
} from './automation-hooks.utils';

type ActionExecutionResult =
  | {
      status: 'fired';
      workflowRunId?: string;
      message?: string;
    }
  | {
      status: 'skipped';
      message: string;
    };

async function validateHookActionPayload(params: {
  actionType: AutomationHookActionType;
  actionPayload: Record<string, unknown>;
  ensureWorkflowExists: (workflowId: string) => Promise<void>;
}): Promise<void> {
  if (params.actionType === AutomationHookActionType.INVOKE_WORKFLOW) {
    const workflowId = readStringFromPayload(
      params.actionPayload,
      'workflow_id',
    );
    if (!workflowId) {
      throw new BadRequestException(
        'action_payload.workflow_id is required for invoke_workflow action',
      );
    }

    await params.ensureWorkflowExists(workflowId);
    return;
  }

  if (params.actionType === AutomationHookActionType.EMIT_EVENT) {
    const eventName = readStringFromPayload(params.actionPayload, 'event_name');
    if (!eventName) {
      throw new BadRequestException(
        'action_payload.event_name is required for emit_event action',
      );
    }
  }
}

async function executeHookAction(params: {
  hook: AutomationHook;
  triggerType: AutomationHookTriggerType;
  payload: Record<string, unknown>;
  resolveWorkflowId: (workflowId: string) => Promise<string>;
  startWorkflow: (
    workflowId: string,
    triggerData: Record<string, unknown>,
  ) => Promise<string | null>;
  emitEvent: (eventName: string, payload: Record<string, unknown>) => void;
}): Promise<ActionExecutionResult> {
  if (params.hook.action_type === AutomationHookActionType.INVOKE_WORKFLOW) {
    const workflowId = readStringFromPayload(
      params.hook.action_payload,
      'workflow_id',
    );
    if (!workflowId) {
      throw new BadRequestException(
        `Automation hook ${params.hook.id} action_payload.workflow_id is required`,
      );
    }

    const resolvedWorkflowId = await params.resolveWorkflowId(workflowId);
    const failedWorkflowId = readStringFromPayload(
      params.payload,
      'workflow_id',
    );
    if (
      params.triggerType === AutomationHookTriggerType.WORKFLOW_RUN_FAILED &&
      failedWorkflowId === resolvedWorkflowId
    ) {
      return {
        status: 'skipped',
        message:
          'Skipping invoke_workflow hook because failed workflow matches target workflow',
      };
    }

    const workflowRunId = await params.startWorkflow(resolvedWorkflowId, {
      event: 'automation.hook',
      source: 'automation_hook',
      scopeId: params.hook.scopeId,
      hookId: params.hook.id,
      hookTriggerType: params.triggerType,
      hookActionType: params.hook.action_type,
      context: params.payload,
    });

    if (!workflowRunId) {
      return {
        status: 'skipped',
        message:
          'Workflow start returned no run id (likely skipped by concurrency policy)',
      };
    }

    return {
      status: 'fired',
      workflowRunId,
    };
  }

  if (params.hook.action_type === AutomationHookActionType.EMIT_EVENT) {
    const eventName = readStringFromPayload(
      params.hook.action_payload,
      'event_name',
    );
    if (!eventName) {
      throw new BadRequestException(
        `Automation hook ${params.hook.id} action_payload.event_name is required`,
      );
    }

    const eventPayload =
      readObjectFromPayload(params.hook.action_payload, 'payload') ??
      params.payload;
    params.emitEvent(eventName, eventPayload);

    return {
      status: 'fired',
    };
  }

  // RECORD_METADATA persists audit evidence without dispatching runtime actions.
  return {
    status: 'fired',
    message: 'metadata_recorded',
  };
}

export { executeHookAction, validateHookActionPayload };
export type { ActionExecutionResult };
