import type {
  BudgetQueryParams,
  BudgetSummaryParams,
  BudgetSummaryRow,
  BudgetTimelineRow,
  BudgetUsageEventResponse,
  EvaluateActionRequest,
  RecordUsageEventRequest,
} from '@nexus/core';

export type EvaluateActionDto = EvaluateActionRequest;
export type RecordUsageEventDto = RecordUsageEventRequest;
export type BudgetQueryDto = BudgetQueryParams;
export type BudgetSummaryDto = BudgetSummaryParams;
export type { BudgetSummaryRow, BudgetTimelineRow, BudgetUsageEventResponse };
