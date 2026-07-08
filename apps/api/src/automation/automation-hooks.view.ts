import { AutomationHook } from './database/entities/automation-hook.entity';
import { AutomationHookSummaryView } from './automation-hooks.types';

export function toAutomationHookSummary(
  hook: AutomationHook,
): AutomationHookSummaryView {
  return {
    id: hook.id,
    scopeId: hook.scopeId,
    enabled: hook.enabled,
    trigger_type: hook.trigger_type,
    trigger_filter: hook.trigger_filter ?? null,
    priority: hook.priority,
    action_type: hook.action_type,
    action_payload: hook.action_payload,
    cooldown_window_seconds: hook.cooldown_window_seconds,
    last_fired_at: hook.last_fired_at ?? null,
    created_by: hook.created_by ?? null,
    updated_by: hook.updated_by ?? null,
    created_at: hook.created_at,
    updated_at: hook.updated_at,
  };
}
