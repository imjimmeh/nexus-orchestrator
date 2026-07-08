import { BadRequestException } from '@nestjs/common';
import {
  AutomationHookActionType,
  AutomationHookTriggerType,
} from '@nexus/core';
import { describe, expect, it, vi } from 'vitest';
import { AutomationHook } from './database/entities/automation-hook.entity';
import {
  executeHookAction,
  validateHookActionPayload,
} from './automation-hooks.action';

function buildHook(overrides?: Partial<AutomationHook>): AutomationHook {
  const now = new Date('2026-04-12T16:00:00.000Z');
  return {
    id: 'hook-1',
    scopeId: 'project-1',
    enabled: true,
    trigger_type: AutomationHookTriggerType.WORKFLOW_RUN_FAILED,
    trigger_filter: null,
    priority: 100,
    action_type: AutomationHookActionType.RECORD_METADATA,
    action_payload: {},
    cooldown_window_seconds: 60,
    last_fired_at: null,
    created_by: null,
    updated_by: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe('automation-hooks.action', () => {
  it('enforces workflow_id for invoke_workflow action payloads', async () => {
    await expect(
      validateHookActionPayload({
        actionType: AutomationHookActionType.INVOKE_WORKFLOW,
        actionPayload: {},
        ensureWorkflowExists: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns metadata result without runtime side-effects', async () => {
    const resolveWorkflowId = vi.fn();
    const startWorkflow = vi.fn();
    const emitEvent = vi.fn();

    const result = await executeHookAction({
      hook: buildHook({
        action_type: AutomationHookActionType.RECORD_METADATA,
        action_payload: { reason: 'policy-note' },
      }),
      triggerType: AutomationHookTriggerType.WORKFLOW_RUN_FAILED,
      payload: { severity: 'high' },
      resolveWorkflowId,
      startWorkflow,
      emitEvent,
    });

    expect(result).toEqual({
      status: 'fired',
      message: 'metadata_recorded',
    });
    expect(resolveWorkflowId).not.toHaveBeenCalled();
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(emitEvent).not.toHaveBeenCalled();
  });

  it('returns skipped when invoke_workflow returns no workflow run id', async () => {
    const resolveWorkflowId = vi.fn().mockResolvedValue('workflow-1-uuid');
    const startWorkflow = vi.fn().mockResolvedValue(null);
    const emitEvent = vi.fn();

    const result = await executeHookAction({
      hook: buildHook({
        action_type: AutomationHookActionType.INVOKE_WORKFLOW,
        action_payload: {
          workflow_id: 'workflow-1',
          payload: { source: 'hook' },
        },
      }),
      triggerType: AutomationHookTriggerType.WORKFLOW_RUN_FAILED,
      payload: { signal: 'heartbeat' },
      resolveWorkflowId,
      startWorkflow,
      emitEvent,
    });

    expect(result.status).toBe('skipped');
    expect(resolveWorkflowId).toHaveBeenCalledWith('workflow-1');
    expect(startWorkflow).toHaveBeenCalledTimes(1);
    expect(startWorkflow).toHaveBeenCalledWith(
      'workflow-1-uuid',
      expect.any(Object),
    );
  });

  it('resolves symbolic workflow_id before starting invoke_workflow hooks', async () => {
    const resolveWorkflowId = vi.fn().mockResolvedValue('workflow-1-uuid');
    const startWorkflow = vi.fn().mockResolvedValue('run-1');
    const emitEvent = vi.fn();

    const result = await executeHookAction({
      hook: buildHook({
        action_type: AutomationHookActionType.INVOKE_WORKFLOW,
        action_payload: {
          workflow_id: 'workflow_failure_doctor',
          payload: { source: 'hook' },
        },
      }),
      triggerType: AutomationHookTriggerType.WORKFLOW_RUN_FAILED,
      payload: { signal: 'heartbeat' },
      resolveWorkflowId,
      startWorkflow,
      emitEvent,
    });

    expect(resolveWorkflowId).toHaveBeenCalledWith('workflow_failure_doctor');
    expect(startWorkflow).toHaveBeenCalledWith(
      'workflow-1-uuid',
      expect.objectContaining({
        event: 'automation.hook',
        source: 'automation_hook',
        scopeId: 'project-1',
        hookTriggerType: AutomationHookTriggerType.WORKFLOW_RUN_FAILED,
        hookActionType: AutomationHookActionType.INVOKE_WORKFLOW,
        context: { signal: 'heartbeat' },
      }),
    );
    expect(result).toEqual({
      status: 'fired',
      workflowRunId: 'run-1',
    });
  });

  it('skips invoke_workflow when failed workflow matches hook target', async () => {
    const resolveWorkflowId = vi.fn().mockResolvedValue('workflow-1-uuid');
    const startWorkflow = vi.fn();
    const emitEvent = vi.fn();

    const result = await executeHookAction({
      hook: buildHook({
        action_type: AutomationHookActionType.INVOKE_WORKFLOW,
        action_payload: {
          workflow_id: 'workflow_failure_doctor',
          payload: { source: 'hook' },
        },
      }),
      triggerType: AutomationHookTriggerType.WORKFLOW_RUN_FAILED,
      payload: {
        workflow_id: 'workflow-1-uuid',
      },
      resolveWorkflowId,
      startWorkflow,
      emitEvent,
    });

    expect(resolveWorkflowId).toHaveBeenCalledWith('workflow_failure_doctor');
    expect(startWorkflow).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: 'skipped',
      message:
        'Skipping invoke_workflow hook because failed workflow matches target workflow',
    });
  });
});
