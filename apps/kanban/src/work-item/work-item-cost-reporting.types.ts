import type { WorkItemCostEstimationService } from "./cost-estimation/work-item-cost-estimation.service";

export type CostEstimator = Pick<WorkItemCostEstimationService, "estimate">;

export type WorkItemCostSummarySource = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  cost_cents: number;
  token_spend: number;
  type: string;
  story_points: number | null;
  execution_config: Record<string, unknown> | null;
};

export type WorkItemCostSummaryRow = {
  id: string;
  project_id: string;
  title: string;
  status: string;
  costCents: number;
  tokenSpend: number;
  predictedRemainingCostCents: number | null;
  projectedTotalCostCents: number | null;
};

export type WorkItemCostAttemptForAccuracy = {
  work_item_id: string;
  workflow_id: string | null;
  type: string;
  story_points: number | null;
  total_cost_cents: number;
};

export type CostEstimateAccuracyResult = {
  sampleCount: number;
  meanAbsoluteErrorCents: number;
  meanAbsolutePercentageError: number | null;
};
