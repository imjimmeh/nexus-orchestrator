import { AutomationHook } from './database/entities/automation-hook.entity';
import { EventLedgerService } from '../observability/event-ledger.service';

async function emitHookCooldownSkippedAudit(
  eventLedger: EventLedgerService,
  hook: AutomationHook,
): Promise<void> {
  await eventLedger.emitBestEffort({
    domain: 'automation',
    eventName: 'automation.hook.dispatch.skipped_cooldown',
    outcome: 'denied',
    context: {
      scopeId: hook.scopeId,
      contextId: null,
      contextType: null,
      scopeNodeId: null,
      scopePath: null,
    },
    payload: {
      hookId: hook.id,
      triggerType: hook.trigger_type,
      cooldownWindowSeconds: hook.cooldown_window_seconds,
    },
  });
}

async function emitHookDispatchSucceededAudit(
  eventLedger: EventLedgerService,
  hook: AutomationHook,
  params: {
    workflowRunId?: string;
    message?: string;
  },
): Promise<void> {
  await eventLedger.emitBestEffort({
    domain: 'automation',
    eventName: 'automation.hook.dispatch.succeeded',
    outcome: 'success',
    context: {
      scopeId: hook.scopeId,
      contextId: null,
      contextType: null,
      scopeNodeId: null,
      scopePath: null,
    },
    workflowRunId: params.workflowRunId,
    payload: {
      hookId: hook.id,
      triggerType: hook.trigger_type,
      actionType: hook.action_type,
      message: params.message ?? null,
    },
  });
}

async function emitHookDispatchSkippedAudit(
  eventLedger: EventLedgerService,
  hook: AutomationHook,
  message: string,
): Promise<void> {
  await eventLedger.emitBestEffort({
    domain: 'automation',
    eventName: 'automation.hook.dispatch.skipped',
    outcome: 'denied',
    context: {
      scopeId: hook.scopeId,
      contextId: null,
      contextType: null,
      scopeNodeId: null,
      scopePath: null,
    },
    payload: {
      hookId: hook.id,
      triggerType: hook.trigger_type,
      actionType: hook.action_type,
      message,
    },
  });
}

async function emitHookDispatchFailedAudit(
  eventLedger: EventLedgerService,
  hook: AutomationHook,
  errorMessage: string,
): Promise<void> {
  await eventLedger.emitBestEffort({
    domain: 'automation',
    eventName: 'automation.hook.dispatch.failed',
    outcome: 'failure',
    context: {
      scopeId: hook.scopeId,
      contextId: null,
      contextType: null,
      scopeNodeId: null,
      scopePath: null,
    },
    payload: {
      hookId: hook.id,
      triggerType: hook.trigger_type,
      actionType: hook.action_type,
    },
    errorMessage,
  });
}

export {
  emitHookCooldownSkippedAudit,
  emitHookDispatchFailedAudit,
  emitHookDispatchSkippedAudit,
  emitHookDispatchSucceededAudit,
};
