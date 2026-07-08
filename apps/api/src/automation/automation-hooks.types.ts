import {
  AutomationHookActionType,
  AutomationHookTriggerType,
} from '@nexus/core';

export interface AutomationHookSummaryView {
  id: string;
  scopeId: string;
  enabled: boolean;
  trigger_type: AutomationHookTriggerType;
  trigger_filter: Record<string, unknown> | null;
  priority: number;
  action_type: AutomationHookActionType;
  action_payload: Record<string, unknown>;
  cooldown_window_seconds: number;
  last_fired_at: Date | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListAutomationHooksResult {
  items: AutomationHookSummaryView[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateAutomationHookParams {
  scopeId: string;
  enabled?: boolean;
  trigger_type: AutomationHookTriggerType;
  trigger_filter?: Record<string, unknown>;
  priority?: number;
  action_type: AutomationHookActionType;
  action_payload: Record<string, unknown>;
  cooldown_window_seconds?: number;
  created_by?: string;
}

export interface UpdateAutomationHookParams {
  enabled?: boolean;
  trigger_type?: AutomationHookTriggerType;
  trigger_filter?: Record<string, unknown>;
  priority?: number;
  action_type?: AutomationHookActionType;
  action_payload?: Record<string, unknown>;
  cooldown_window_seconds?: number;
  updated_by?: string;
}

export interface AutomationHookListFilters {
  scopeId?: string;
  triggerType?: AutomationHookTriggerType;
}

export interface AutomationPagination {
  limit: number;
  offset: number;
}

export interface HookDispatchResult {
  trigger_type: AutomationHookTriggerType;
  scopeId: string;
  total: number;
  fired: number;
  skipped: number;
  failed: number;
}
