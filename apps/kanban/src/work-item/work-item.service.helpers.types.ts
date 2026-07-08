// apps/kanban/src/work-item/work-item.service.helpers.types.ts

import type { LifecycleGateFailure } from "./work-item.types";

export interface TransitionGateResult {
  aggregateStatus: string; // passed | skipped | failed | timed_out | unavailable | disabled
  blocked: boolean;
  failures: LifecycleGateFailure[];
}
