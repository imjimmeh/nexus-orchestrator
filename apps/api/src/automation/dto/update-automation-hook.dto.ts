import {
  type UpdateAutomationHookRequest,
  updateAutomationHookSchema,
} from '@nexus/core';

export { updateAutomationHookSchema };

export class UpdateAutomationHookDto implements UpdateAutomationHookRequest {
  static get schema() {
    return updateAutomationHookSchema;
  }

  enabled?: boolean;

  trigger_type?: UpdateAutomationHookRequest['trigger_type'];

  trigger_filter?: Record<string, unknown>;

  priority?: number;

  action_type?: UpdateAutomationHookRequest['action_type'];

  action_payload?: Record<string, unknown>;

  cooldown_window_seconds?: number;

  updated_by?: string;
}
