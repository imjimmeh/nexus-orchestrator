import {
  FailureClass,
  type CoreWorkflowEventEnvelopeV1Shape,
} from "@nexus/core";
import {
  isRealWorkItemId,
  type TerminalWorkflowStatus,
} from "./core-lifecycle-stream.helpers";
import {
  readUsageEstimatedCostCents,
  readUsageTotalTokens,
} from "./core-lifecycle-stream-usage.helpers";
import type {
  TerminalProjectionDeps,
  TerminalWorkItemRunDeps,
} from "./core-lifecycle-stream-terminal-projection.types";
import type { ModelUsageBreakdownRow } from "../database/entities/kanban-work-item-run-cost.entity.types";

/**
 * Resolves the project id for a workflow run, falling back to the
 * orchestration row keyed by `linked_workflow_run_id` when the lifecycle
 * event carries no project context. Logs and returns `null` on read
 * failure so the caller can skip the terminal evaluation.
 */
export async function resolveProjectIdForWorkflowRun(
  deps: TerminalProjectionDeps,
  workflowRunId: string,
  context: CoreWorkflowEventEnvelopeV1Shape["payload"]["context"],
): Promise<string | null> {
  const contextProjectId = context?.scopeId ?? context?.contextId;
  if (contextProjectId) {
    return contextProjectId;
  }

  try {
    const orchestration =
      await deps.orchestrationService.findByLinkedWorkflowRun(workflowRunId);
    return orchestration?.project_id ?? null;
  } catch (error) {
    deps.logger.warn(
      `Failed to resolve orchestration linked to workflow run ${workflowRunId}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

/**
 * Projects a terminal run's cumulative token usage and estimated cost
 * onto its work item. Idempotency relies on at-most-once stream
 * delivery (the cursor advances exclusively) and exactly one terminal
 * event per run id, so the additive accrual runs once per run.
 */
export async function accrueWorkItemTokenSpend(
  deps: TerminalProjectionDeps,
  params: {
    projectId: string;
    workItemId: string | undefined;
    payload: CoreWorkflowEventEnvelopeV1Shape["payload"];
  },
): Promise<void> {
  if (!isRealWorkItemId(params.workItemId)) {
    return;
  }

  const tokenAmount = readUsageTotalTokens(params.payload);
  if (tokenAmount > 0) {
    try {
      await deps.workItems.addTokenSpend({
        project_id: params.projectId,
        workItemId: params.workItemId,
        amount: tokenAmount,
      });
    } catch (error) {
      deps.logger.warn(
        `Failed to accrue token spend for work item ${params.workItemId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const costCents = readUsageEstimatedCostCents(params.payload);
  if (costCents > 0) {
    try {
      await deps.workItems.addCostSpend({
        project_id: params.projectId,
        workItemId: params.workItemId,
        amountCents: costCents,
      });
    } catch (error) {
      deps.logger.warn(
        `Failed to accrue cost spend for work item ${params.workItemId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Records a single terminal-run cost attempt for later bucket/statistics
 * aggregation. No-ops when the payload has no cost, the run is synthetic, or
 * the work item cannot be resolved.
 */
export async function recordWorkItemRunCostAttempt(
  deps: TerminalProjectionDeps,
  params: {
    projectId: string;
    workflowId: string;
    runId: string;
    workItemId: string | undefined;
    payload: CoreWorkflowEventEnvelopeV1Shape["payload"];
  },
): Promise<void> {
  if (!isRealWorkItemId(params.workItemId)) {
    return;
  }

  const costCents = readUsageEstimatedCostCents(params.payload);
  if (costCents <= 0) {
    return;
  }

  const workItem = await deps.workItems.findByProjectAndId(
    params.projectId,
    params.workItemId,
  );
  if (!workItem) {
    return;
  }

  const usage = (
    params.payload as {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        priced_turn_count?: number;
        model_breakdown?: unknown;
      } | null;
    }
  ).usage;
  const breakdown =
    usage && typeof usage === "object" && !Array.isArray(usage)
      ? (usage as { model_breakdown?: unknown }).model_breakdown
      : undefined;
  const modelBreakdown = Array.isArray(breakdown)
    ? (breakdown as ModelUsageBreakdownRow[])
    : [];

  await deps.workItemRunCosts.recordAttempt({
    work_item_id: params.workItemId,
    run_id: params.runId,
    workflow_id: params.workflowId,
    type: workItem.type,
    story_points: workItem.story_points,
    priority: workItem.priority,
    model_breakdown: modelBreakdown,
    total_input_tokens: usage?.input_tokens ?? 0,
    total_output_tokens: usage?.output_tokens ?? 0,
    total_cost_cents: costCents,
    priced_turn_count: usage?.priced_turn_count ?? 0,
    started_at: null,
    completed_at: null,
  });
}

/**
 * Reconciles a terminal workflow run against its linked orchestration
 * row. Catches and logs reconciliation failures so the caller can
 * continue with the rest of the terminal evaluation.
 */
export function reconcileTerminalWorkflowRun(
  deps: TerminalWorkItemRunDeps,
  params: {
    projectId: string;
    workflowRunId: string;
    terminalStatus: TerminalWorkflowStatus;
  },
): Promise<{ cleared: boolean } | undefined> {
  return deps.orchestrationService
    .reconcileLinkedWorkflowRun(params.projectId, {
      workflowRunId: params.workflowRunId,
      status: params.terminalStatus,
    })
    .catch((error: unknown) => {
      deps.logger.warn(
        `Failed to reconcile linked workflow run ${params.workflowRunId} for project ${params.projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    });
}

/**
 * Records repair evidence for a failed work-item run, mapping the QA
 * rejection marker in the work-item metadata to the appropriate
 * `FailureClass` so the failure is observed but not double-counted.
 */
export async function recordTerminalRepairEvidence(
  deps: TerminalWorkItemRunDeps,
  params: {
    projectId: string;
    workflowRunId: string;
    workItemId: string | undefined;
    terminalStatus: TerminalWorkflowStatus;
    isFailedWorkItemRun: boolean;
  },
): Promise<void> {
  if (
    !params.isFailedWorkItemRun ||
    !params.workItemId ||
    params.terminalStatus === "COMPLETED"
  ) {
    return;
  }

  await deps.repairLane.recordFailedWorkItemRun({
    projectId: params.projectId,
    workflowRunId: params.workflowRunId,
    workItemId: params.workItemId,
    status: params.terminalStatus,
    failureClass: await resolveWorkItemRunFailureClass(deps, {
      projectId: params.projectId,
      workItemId: params.workItemId,
    }),
  });
}

/**
 * Resolves the {@link FailureClass} for a terminal work item run
 * failure. The QA agent's rejection of the work item output is
 * recorded on the work item's metadata (`qa_decision: "reject"`); we
 * map that to {@link FailureClass.QaRejection} so the failure is
 * observed but NOT counted toward the failure-threshold
 * retrospective trigger. All other failures are treated as
 * {@link FailureClass.SystemFailure} (container-lost,
 * orchestrator-error, infra regressions, etc.) and DO count.
 *
 * Best-effort: any metadata-read error is logged and the failure is
 * conservatively classified as `SystemFailure` so it still counts.
 *
 * Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062).
 */
export async function resolveWorkItemRunFailureClass(
  deps: TerminalProjectionDeps,
  params: { projectId: string; workItemId: string },
): Promise<FailureClass> {
  try {
    const item = await deps.workItems.findByProjectAndId(
      params.projectId,
      params.workItemId,
    );
    const metadata = item?.metadata;
    if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
      const record: Record<string, unknown> = metadata;
      if (record.qa_decision === "reject") {
        return FailureClass.QaRejection;
      }
    }
  } catch (error) {
    deps.logger.warn(
      `Failed to read work item ${params.workItemId} metadata for failure classification: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return FailureClass.SystemFailure;
}
