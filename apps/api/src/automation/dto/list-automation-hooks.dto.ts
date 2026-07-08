import {
  listAutomationHooksSchema,
  type ListAutomationHooksRequest,
} from '@nexus/core';

export { listAutomationHooksSchema };

export class ListAutomationHooksDto implements ListAutomationHooksRequest {
  static get schema() {
    return listAutomationHooksSchema;
  }

  scopeId?: string;

  trigger_type?: ListAutomationHooksRequest['trigger_type'];

  limit: number = 50;

  offset: number = 0;
}
