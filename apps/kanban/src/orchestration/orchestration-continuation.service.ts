import { forwardRef, Inject, Injectable, Logger } from "@nestjs/common";
import { FailureClass } from "@nexus/core";
import { DispatchService } from "../dispatch/dispatch.service";
import { KanbanWorkItemRepository } from "../database/repositories/kanban-work-item.repository";
import { WorkItemService } from "../work-item/work-item.service";
import { OrchestrationService } from "./orchestration.service";
import type {
  EvaluateContinuationInput,
  EvaluateContinuationResult,
} from "./orchestration-continuation.types";
import { CoreWorkflowClientService } from "../core/core-workflow-client.service";
import { ProjectOrchestrationWakeupService } from "./project-orchestration-wakeup.service";
import type { WorkflowRunStatus } from "@nexus/core";
import {
  findTargetBranchBlockers,
  formatTargetBranchBlockerReason as formatExternalReason,
} from "./orchestration-branch-blockers";
import type { TargetBranchBlocker } from "./orchestration-branch-blockers.types";
import { ContinuationHandler } from "./orchestration-continuation.handler";

type WorkItemRecord = {
  id: string;
  status: string;
  linked_run_id?: string | null;
  current_execution_id?: string | null;
  metadata?: Record<string, unknown> | null;
  execution_config?: Record<string, unknown> | null;
  executionConfig?: Record<string, unknown> | null;
};

type DependencyRecord = {
  work_item_id: string;
  depends_on_work_item_id: string;
};

type OrchestrationStateRecord = {
  project_id: string;
  linked_run_id?: string | null;
};

type CoreWorkflowClient = Pick<
  CoreWorkflowClientService,
  "getWorkflowRunStatus"
>;

type ReconcileResult =
  | { kind: "skip" }
  | {
      kind: "noLinkedRun";
      consecutiveFailure?: boolean;
      failureClass?: FailureClass;
    }
  | { kind: "workflowRunId"; workflowRunId: string };

const TERMINAL_WORKFLOW_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

@Injectable()
export class OrchestrationContinuationService {
  private readonly logger = new Logger(OrchestrationContinuationService.name);
  private readonly handler: ContinuationHandler;
  constructor(
    private readonly orchestrationService: OrchestrationService,
    private readonly dispatchService: DispatchService,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly workItemService: WorkItemService,
    @Inject(forwardRef(() => ProjectOrchestrationWakeupService))
    private readonly wakeupService: ProjectOrchestrationWakeupService,
    @Inject(CoreWorkflowClientService)
    private readonly coreWorkflowClient: CoreWorkflowClient,
  ) {
    this.handler = new ContinuationHandler(
      orchestrationService,
      dispatchService,
      workItems,
      workItemService,
      coreWorkflowClient,
    );
  }

  async evaluateProjectContinuation(
    input: EvaluateContinuationInput,
  ): Promise<EvaluateContinuationResult> {
    const items = (await this.workItems.findByproject_id(
      input.projectId,
    )) as WorkItemRecord[];
    await this.retireImportedRepoBootstrapIfNeeded(input.projectId, items);
    const state = await this.handler.buildEvaluationState(input, items);
    // Use the full, status-unfiltered item list here (not state.activeItems)
    // so findTargetBranchBlockers' internal container-exclusion check can
    // see done children — otherwise a still-todo parent whose only child is
    // already done would be misidentified as a childless, genuinely
    // dispatchable item contending for the target branch.
    const branchBlockers = this.findTargetBranchBlockers(state.allItems);
    if (branchBlockers.length > 0) {
      return this.handler.recordRepeatAndMaybeEmit(
        input,
        this.formatTargetBranchBlockerReason(input.projectId, branchBlockers),
      );
    }
    return this.handler.evaluateProjectContinuation(input, state);
  }

  async reconcileStaleContinuations(): Promise<{ evaluated: number }> {
    let evaluated = 0;
    const states = await this.orchestrationService.findOrchestratingStates();
    for (const state of states) {
      const result = await this.reconcileLinkedRunForStaleState(state);
      if (result.kind === "skip") {
        continue;
      }
      evaluated += 1;
      await this.evaluateProjectContinuation({
        projectId: state.project_id,
        trigger: "poll_reconciliation",
        ...(result.kind === "workflowRunId"
          ? { workflowRunId: result.workflowRunId }
          : {}),
        ...(result.kind === "noLinkedRun" && result.consecutiveFailure
          ? {
              consecutiveFailure: true,
              failureClass: result.failureClass,
            }
          : {}),
      });
    }
    return { evaluated };
  }

  private findTargetBranchBlockers(
    items: WorkItemRecord[],
  ): TargetBranchBlocker[] {
    return findTargetBranchBlockers(items);
  }

  private formatTargetBranchBlockerReason(
    projectId: string,
    blockers: TargetBranchBlocker[],
  ): string {
    if (blockers.length === 0) {
      return `Board stewardship required: project ${projectId} has unresolved target branch contention.`;
    }
    return `Board stewardship required: ${formatExternalReason(projectId, blockers[0])}.`;
  }

  private async dispatchContinuation(
    input: EvaluateContinuationInput,
    _dispatchableItems: WorkItemRecord[] = [],
  ): Promise<void> {
    await this.dispatchService.requestOrchestrationCycle(input.projectId);
  }

  private async reconcileLinkedRunForStaleState(
    state: OrchestrationStateRecord,
  ): Promise<ReconcileResult> {
    const linkedRunId = state.linked_run_id;
    if (!linkedRunId) {
      return { kind: "noLinkedRun" };
    }
    const workflowStatus = await this.coreWorkflowClient.getWorkflowRunStatus(
      linkedRunId,
      `kanban-continuation-reconcile:${state.project_id}:${linkedRunId}`,
    );
    const status = workflowStatus.status;
    if (!this.isTerminalWorkflowStatus(status)) {
      return { kind: "workflowRunId", workflowRunId: linkedRunId };
    }
    const reconcileResult =
      await this.orchestrationService.reconcileLinkedWorkflowRun(
        state.project_id,
        { workflowRunId: linkedRunId, status },
      );
    if (!reconcileResult.cleared) {
      return { kind: "skip" };
    }
    // Failure-threshold retrospective trigger (work item 2b8d0c51 /
    // EPIC-117 / EPIC-202). When a workflow run has FAILED, signal the
    // failure via the ReconcileResult so the cycle decision service can
    // record the failure and (at the threshold) fire a
    // `failure_threshold` retrospective. The OrchestrationCycleDecisionService
    // is the only orchestrator-side caller of `checkFailureThreshold`.
    //
    // The failure is classified as `SystemFailure` (the orchestrator's
    // poll path never sees QA rejections — those are emitted by the
    // core-lifecycle-stream consumer with `QaRejection`). The cycle
    // decision service still applies `shouldCountFailure` so the
    // classification is honoured end-to-end.
    //
    // Work item: 2a64258d-8542-4ca0-b582-42a69dd61ff0 (WI-2026-062).
    return {
      kind: "noLinkedRun",
      ...(status === "FAILED"
        ? {
            consecutiveFailure: true,
            failureClass: FailureClass.SystemFailure,
          }
        : {}),
    };
  }

  private isTerminalWorkflowStatus(
    status: WorkflowRunStatus,
  ): status is "COMPLETED" | "FAILED" | "CANCELLED" {
    return TERMINAL_WORKFLOW_STATUSES.has(status);
  }

  private getActiveContinuationItems(
    items: WorkItemRecord[],
  ): WorkItemRecord[] {
    return this.handler.getActiveContinuationItems(items);
  }

  private groupDependencyIds(
    dependencies: DependencyRecord[],
  ): Map<string, string[]> {
    return this.handler.groupDependencyIds(dependencies);
  }

  private async retireImportedRepoBootstrapIfNeeded(
    projectId: string,
    items: WorkItemRecord[],
  ): Promise<void> {
    await this.handler.retireImportedRepoBootstrapIfNeeded(projectId, items);
  }
}
