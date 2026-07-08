import type { IBrowserAutomationActionRequest } from '@nexus/core';

export type BrowserRuntimeActionInput = Omit<
  IBrowserAutomationActionRequest,
  'action'
>;
