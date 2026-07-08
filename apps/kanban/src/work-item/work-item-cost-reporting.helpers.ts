import type {
  CostEstimateAccuracyResult,
  CostEstimator,
  WorkItemCostAttemptForAccuracy,
  WorkItemCostSummaryRow,
  WorkItemCostSummarySource,
} from "./work-item-cost-reporting.types";

function readOptionalString(
  value: Record<string, unknown> | null,
  key: string,
): string | null {
  const raw = value?.[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

function averageOrZero(values: number[]): number {
  return values.length > 0
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : 0;
}

function sumAttemptsPerWorkItemWithCost(
  attempts: WorkItemCostAttemptForAccuracy[],
): Array<{
  workflowId: string | null;
  type: string;
  storyPoints: number | null;
  totalCostCents: number;
}> {
  const totals = new Map<
    string,
    {
      workflowId: string | null;
      type: string;
      storyPoints: number | null;
      totalCostCents: number;
    }
  >();

  for (const attempt of attempts) {
    const existing = totals.get(attempt.work_item_id);
    if (existing) {
      existing.totalCostCents += attempt.total_cost_cents;
      continue;
    }

    totals.set(attempt.work_item_id, {
      workflowId: attempt.workflow_id,
      type: attempt.type,
      storyPoints: attempt.story_points,
      totalCostCents: attempt.total_cost_cents,
    });
  }

  return Array.from(totals.values());
}

function getStageWorkflowId(status: string): string {
  switch (status) {
    case "refinement":
      return "work_item_refinement_default";
    case "in-review":
      return "work_item_in_review_default";
    case "ready-to-merge":
      return "work_item_ready_to_merge_default";
    case "in-progress":
    case "todo":
    case "backlog":
    default:
      return "work_item_in_progress_default";
  }
}

export async function buildWorkItemCostSummary(
  items: WorkItemCostSummarySource[],
  costEstimation: CostEstimator,
): Promise<WorkItemCostSummaryRow[]> {
  return Promise.all(
    items.map(async (item) => {
      if (item.status === "done") {
        return {
          id: item.id,
          project_id: item.project_id,
          title: item.title,
          status: item.status,
          costCents: item.cost_cents,
          tokenSpend: item.token_spend,
          predictedRemainingCostCents: 0,
          projectedTotalCostCents: item.cost_cents,
        };
      }

      const baseWorkflowId =
        readOptionalString(item.execution_config, "workflowId") ??
        getStageWorkflowId(item.status);
      const estimate = await costEstimation.estimate({
        workflowId: baseWorkflowId ? `${baseWorkflowId}:complete` : null,
        type: item.type,
        storyPoints: item.story_points,
        modelId: readOptionalString(item.execution_config, "model"),
      });
      const predictedRemainingCostCents = estimate.available
        ? estimate.estimatedCostCents
        : null;

      return {
        id: item.id,
        project_id: item.project_id,
        title: item.title,
        status: item.status,
        costCents: item.cost_cents,
        tokenSpend: item.token_spend,
        predictedRemainingCostCents,
        projectedTotalCostCents:
          predictedRemainingCostCents === null
            ? null
            : item.cost_cents + predictedRemainingCostCents,
      };
    }),
  );
}

export async function computeCostEstimateAccuracy(
  attempts: WorkItemCostAttemptForAccuracy[],
  costEstimation: CostEstimator,
): Promise<CostEstimateAccuracyResult> {
  const absoluteErrors: number[] = [];
  const percentageErrors: number[] = [];

  for (const total of sumAttemptsPerWorkItemWithCost(attempts)) {
    const baseWf = total.workflowId ?? "work_item_in_progress_default";
    const estimate = await costEstimation.estimate({
      workflowId: `${baseWf}:complete`,
      type: total.type,
      storyPoints: total.storyPoints,
      modelId: null,
    });

    if (!estimate.available || estimate.estimatedCostCents === null) {
      continue;
    }

    const absoluteError = Math.abs(
      total.totalCostCents - estimate.estimatedCostCents,
    );
    absoluteErrors.push(absoluteError);

    if (total.totalCostCents > 0) {
      percentageErrors.push(absoluteError / total.totalCostCents);
    }
  }

  return {
    sampleCount: absoluteErrors.length,
    meanAbsoluteErrorCents: averageOrZero(absoluteErrors),
    meanAbsolutePercentageError:
      percentageErrors.length > 0 ? averageOrZero(percentageErrors) : null,
  };
}
