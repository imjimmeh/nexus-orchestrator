import {
  createAutomationHookSchema,
  type CreateAutomationHookRequest,
} from '@nexus/core';

export { createAutomationHookSchema };

export class CreateAutomationHookDto implements CreateAutomationHookRequest {
  static get schema() {
    return createAutomationHookSchema;
  }

  scopeId!: string;

  enabled?: boolean;

  trigger_type!: CreateAutomationHookRequest['trigger_type'];

  trigger_filter?: Record<string, unknown>;

  priority?: number;

  action_type!: CreateAutomationHookRequest['action_type'];

  action_payload!: Record<string, unknown>;

  cooldown_window_seconds?: number;

  created_by?: string;
}
