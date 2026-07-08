import { NotFoundException } from "@nestjs/common";
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
import { findTargetBranchBlocker } from "./orchestration-branch-blockers";
import { filterDispatchableTodo } from "../work-item/work-item-dispatchable.helper";

type WorkItemRecord = {
  id: string;
  status: string;
  type?: string | null;
  parent_work_item_id?: string | null;
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

type CoreWorkflowClient = Pick<
  CoreWorkflowClientService,
  "getWorkflowRunStatus"
>;

const DISPATCHABLE_STATUSES = new Set(["todo"]);
const IMPORTED_REPO_BOOTSTRAP_SOURCE_ID = "imported-repo-bootstrap";
const IMPORTED_REPO_WORK_ITEM_SOURCE_ID_PREFIX = "imported-repo:";

/**
 * ContinuationHandler — extracted cluster of helpers for
 * OrchestrationContinuationService. Owns the cycle-decision persistence
 * and dispatch-delegation logic that previously bloated the service.
 * The service keeps the public surface, constructor DI metadata, and
 * the AC-2 required private methods (findTargetBranchBlockers,
 * formatTargetBranchBlockerReason, dispatchContinuation,
 * reconcileLinkedRunForStaleState, isTerminalWorkflowStatus,
 * getActiveContinuationItems, groupDependencyIds,
 * retireImportedRepoBootstrapIfNeeded).
 *
 * Work item: bf84ac62-f39b-4fa4-af56-0d593ed69646
 */
export class ContinuationHandler {
  constructor(
    private readonly orchestrationService: OrchestrationService,
    private readonly dispatchService: DispatchService,
    private readonly workItems: KanbanWorkItemRepository,
    private readonly workItemService: WorkItemService,
    private readonly coreWorkflowClient: CoreWorkflowClient,
  ) {}

  async evaluateProjectContinuation(
    input: EvaluateContinuationInput,
    state: {
      activeItems: WorkItemRecord[];
      dependencyIdsByItem: Map<string, string[]>;
      itemById: Map<string, WorkItemRecord>;
      allItems: WorkItemRecord[];
    },
  ): Promise<EvaluateContinuationResult> {
    const dispatchableItems = this.findDispatchableItems(
      state.activeItems,
      state.dependencyIdsByItem,
      state.itemById,
      state.allItems,
    );
    if (dispatchableItems.length > 0) {
      return this.recordRepeatAndMaybeEmit(
        input,
        `Project ${input.projectId} has dispatchable work and continuation is marked as repeat`,
      );
    }
    if (this.hasBacklogCandidates(state.activeItems)) {
      return this.recordRepeatAndMaybeEmit(
        input,
        `Board stewardship required: no dispatchable todo work is ready; reprioritize backlog into the current sprint before dispatch.`,
        { failureClass: FailureClass.NoActionableWork },
      );
    }
    if (state.activeItems.length === 0 && state.allItems.length === 0) {
      return this.recordBlockedDecision(
        input,
        `Project ${input.projectId} has zero work items after orchestration continuation; bootstrap/spec generation did not produce dispatchable work`,
      );
    }
    return this.evaluateBlockedOrPauseOutcome(input, state.activeItems);
  }

  async buildEvaluationState(
    input: EvaluateContinuationInput,
    items: WorkItemRecord[],
  ): Promise<{
    activeItems: WorkItemRecord[];
    dependencyIdsByItem: Map<string, string[]>;
    itemById: Map<string, WorkItemRecord>;
    allItems: WorkItemRecord[];
  }> {
    const activeItems = this.getActiveContinuationItems(items);
    const dependencies = (await this.workItems.findDependenciesByWorkItemIds(
      activeItems.map((item) => item.id),
    )) as DependencyRecord[];
    return {
      activeItems,
      dependencyIdsByItem: this.groupDependencyIds(dependencies),
      itemById: new Map(items.map((item) => [item.id, item])),
      allItems: items,
    };
  }

  async evaluateBlockedOrPauseOutcome(
    input: EvaluateContinuationInput,
    activeItems: WorkItemRecord[],
  ): Promise<EvaluateContinuationResult> {
    const allActiveBlocked =
      activeItems.length > 0 &&
      activeItems.every((item) => item.status === "blocked");
    if (!allActiveBlocked) {
      return this.pauseDecision(input);
    }
    const allActiveFeedbackOnly = activeItems.every((item) =>
      this.isFeedbackOnlyItem(item),
    );
    if (allActiveFeedbackOnly) {
      const mode = await this.resolveMode(input.projectId, input.mode);
      if (mode === "autonomous") {
        return this.recordRepeatAndMaybeEmit(
          input,
          `Project ${input.projectId} has only feedback-needed imported items; continuing autonomously`,
        );
      }
      return this.recordFeedbackSupervisedDecision(input);
    }
    if (this.hasHardBlockers(activeItems)) {
      return this.recordBlockedDecision(
        input,
        `Project ${input.projectId} continuation is blocked by hard-blocked work items`,
      );
    }
    return this.pauseDecision(input);
  }

  findDispatchableItems(
    activeItems: WorkItemRecord[],
    dependencyIdsByItem: Map<string, string[]>,
    itemById: Map<string, WorkItemRecord>,
    allItems: WorkItemRecord[],
  ): WorkItemRecord[] {
    return activeItems.filter((item) =>
      this.isDispatchableWorkItem(
        item,
        dependencyIdsByItem,
        itemById,
        activeItems,
        allItems,
      ),
    );
  }

  hasBacklogCandidates(activeItems: WorkItemRecord[]): boolean {
    return activeItems.some(
      (item) =>
        item.status === "backlog" &&
        !this.isWorkItemInFlight(item) &&
        !this.isRetiredBootstrap(item),
    );
  }

  isDispatchableWorkItem(
    item: WorkItemRecord,
    dependencyIdsByItem: Map<string, string[]>,
    itemById: Map<string, WorkItemRecord>,
    activeItems: WorkItemRecord[],
    allItems: WorkItemRecord[],
  ): boolean {
    return (
      DISPATCHABLE_STATUSES.has(item.status) &&
      // Children-detection must see the full, status-unfiltered sibling
      // list — same semantics as the real dispatch loop
      // (dispatch-work-items.core.ts builds childrenParentIds from ALL
      // project items). Using the status-filtered `activeItems` here would
      // make a done child invisible, falsely treating its still-todo parent
      // as childless/dispatchable.
      this.isDispatchableTodoWithinSiblings(item, allItems) &&
      !this.isWorkItemInFlight(item) &&
      !this.isRetiredBootstrap(item) &&
      this.dependenciesReady(item, dependencyIdsByItem, itemById) &&
      !findTargetBranchBlocker(item, activeItems) &&
      item.id !== "__orchestration_lifecycle__"
    );
  }

  isDispatchableTodoWithinSiblings(
    item: WorkItemRecord,
    siblings: WorkItemRecord[],
  ): boolean {
    return filterDispatchableTodo(
      siblings.map((sibling) => ({
        id: sibling.id,
        status: sibling.status,
        type: sibling.type ?? "story",
        parent_work_item_id: sibling.parent_work_item_id ?? null,
      })),
    ).some((candidate) => candidate.id === item.id);
  }

  groupDependencyIds(dependencies: DependencyRecord[]): Map<string, string[]> {
    const grouped = new Map<string, string[]>();
    for (const dependency of dependencies) {
      const entries = grouped.get(dependency.work_item_id) ?? [];
      entries.push(dependency.depends_on_work_item_id);
      grouped.set(dependency.work_item_id, entries);
    }
    return grouped;
  }

  dependenciesReady(
    item: WorkItemRecord,
    dependencyIdsByItem: Map<string, string[]>,
    itemById: Map<string, WorkItemRecord>,
  ): boolean {
    const dependencyIds = dependencyIdsByItem.get(item.id) ?? [];
    return dependencyIds.every((dependencyId) => {
      const dependency = itemById.get(dependencyId);
      return dependency?.status === "done";
    });
  }

  getActiveContinuationItems(items: WorkItemRecord[]): WorkItemRecord[] {
    return items.filter(
      (item) => item.status !== "done" && !this.isRetiredBootstrap(item),
    );
  }

  isRetiredBootstrap(item: WorkItemRecord): boolean {
    return (
      this.isImportedRepoBootstrap(item) &&
      item.metadata?.retiredByImportedReconciliation === true
    );
  }

  isImportedRepoBootstrap(item: WorkItemRecord): boolean {
    return (
      this.readSourceId(item.metadata) === IMPORTED_REPO_BOOTSTRAP_SOURCE_ID
    );
  }

  hasImportedReconciledWorkItems(items: WorkItemRecord[]): boolean {
    return items.some(
      (item) =>
        this.isReconciledImportedRepoItem(item) &&
        this.readSourceId(item.metadata) !== IMPORTED_REPO_BOOTSTRAP_SOURCE_ID,
    );
  }

  isReconciledImportedRepoItem(item: WorkItemRecord): boolean {
    const sourceId = this.readSourceId(item.metadata);
    const meta = this.readMetadata(item.metadata);
    return (
      sourceId.startsWith(IMPORTED_REPO_WORK_ITEM_SOURCE_ID_PREFIX) &&
      meta.importedRepoReconciliation === true
    );
  }

  isFeedbackOnlyItem(item: WorkItemRecord): boolean {
    const sourceId = this.readSourceId(item.metadata);
    const meta = this.readMetadata(item.metadata);
    return (
      sourceId.startsWith(IMPORTED_REPO_WORK_ITEM_SOURCE_ID_PREFIX) &&
      meta.importedRepoReconciliation === true &&
      meta.feedbackNeeded === true
    );
  }

  hasHardBlockers(items: WorkItemRecord[]): boolean {
    return items.some(
      (item) => item.status === "blocked" && !this.isFeedbackOnlyItem(item),
    );
  }

  isWorkItemInFlight(item: WorkItemRecord): boolean {
    return Boolean(item.linked_run_id || item.current_execution_id);
  }

  readMetadata(metadata: WorkItemRecord["metadata"]): Record<string, unknown> {
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
      return {};
    }
    return metadata;
  }

  readSourceId(metadata: WorkItemRecord["metadata"]): string {
    if (!metadata || typeof metadata !== "object") {
      return "";
    }
    const sourceId = metadata["sourceId"];
    return typeof sourceId === "string" ? sourceId : "";
  }

  async retireImportedRepoBootstrapIfNeeded(
    projectId: string,
    items: WorkItemRecord[],
  ): Promise<void> {
    if (!this.hasImportedReconciledWorkItems(items)) {
      return;
    }
    const bootstrap = items.find((item) => this.isImportedRepoBootstrap(item));
    if (
      !bootstrap ||
      bootstrap.status !== "todo" ||
      this.isRetiredBootstrap(bootstrap)
    ) {
      return;
    }
    const metadata = {
      ...this.readMetadata(bootstrap.metadata),
      retiredByImportedReconciliation: true,
      retiredReason:
        "Imported repository reconciliation published scoped work items.",
      retiredAt: new Date().toISOString(),
    };
    bootstrap.status = "blocked";
    bootstrap.metadata = metadata;
    await this.workItemService.updateStatus(projectId, bootstrap.id, "blocked");
    await this.workItemService.updateWorkItem(projectId, bootstrap.id, {
      metadata,
    });
  }

  pauseDecision(input: EvaluateContinuationInput): EvaluateContinuationResult {
    return {
      decision: "pause",
      emittedCycleRequest: false,
      persisted: false,
      reason: `Project ${input.projectId} is not blocked-only by imported human-decision items`,
    };
  }

  async resolveMode(
    projectId: string,
    explicit?: EvaluateContinuationInput["mode"],
  ): Promise<EvaluateContinuationInput["mode"]> {
    if (explicit) {
      return explicit;
    }
    try {
      const state = await this.orchestrationService.get(projectId);
      return state.orchestrationMode === "supervised"
        ? "supervised"
        : "autonomous";
    } catch (error) {
      if (error instanceof NotFoundException) {
        return "autonomous";
      }
      throw error;
    }
  }

  async recordRepeatAndMaybeEmit(
    input: EvaluateContinuationInput,
    reason: string,
    options: { failureClass?: FailureClass } = {},
  ): Promise<EvaluateContinuationResult> {
    const failureClass = options.failureClass ?? input.failureClass;
    const result = await this.orchestrationService.recordCycleDecision(
      input.projectId,
      {
        decision: "repeat",
        reason,
        ...this.buildIdempotencyKeyInput(input),
        ...this.buildConsecutiveFailureInput(input, failureClass),
      },
    );
    const shouldEmitCycleRequest =
      result.persisted && !result.duplicate && !result.skipped;
    if (shouldEmitCycleRequest) {
      await this.dispatchService.requestOrchestrationCycle(input.projectId);
    }
    return {
      decision: "repeat",
      emittedCycleRequest: shouldEmitCycleRequest,
      persisted: result.persisted,
      reason,
      ...(failureClass !== undefined ? { failureClass } : {}),
    };
  }

  async recordBlockedDecision(
    input: EvaluateContinuationInput,
    reason: string,
  ): Promise<EvaluateContinuationResult> {
    const result = await this.orchestrationService.recordCycleDecision(
      input.projectId,
      {
        decision: "blocked",
        reason,
        ...this.buildIdempotencyKeyInput(input),
        ...this.buildConsecutiveFailureInput(input),
      },
    );
    return {
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: result.persisted,
      reason,
      ...(input.failureClass !== undefined
        ? { failureClass: input.failureClass }
        : {}),
    };
  }

  async recordFeedbackSupervisedDecision(
    input: EvaluateContinuationInput,
  ): Promise<EvaluateContinuationResult> {
    const reason = `Project ${input.projectId} requires human feedback for imported work items (supervised mode)`;
    const result = await this.orchestrationService.recordCycleDecision(
      input.projectId,
      {
        decision: "blocked",
        reason,
        ...this.buildIdempotencyKeyInput(input),
        ...this.buildConsecutiveFailureInput(input),
      },
    );
    return {
      decision: "blocked",
      emittedCycleRequest: false,
      persisted: result.persisted,
      reason,
    };
  }

  buildIdempotencyKey(input: EvaluateContinuationInput): string | undefined {
    if (
      input.trigger === "poll_reconciliation" &&
      !input.workflowRunId &&
      !input.workItemId
    ) {
      return undefined;
    }
    return [
      "continuation",
      input.projectId,
      input.trigger,
      input.workflowRunId ?? input.workItemId ?? "none",
    ].join(":");
  }

  buildIdempotencyKeyInput(
    input: EvaluateContinuationInput,
  ): { idempotencyKey: string } | Record<string, never> {
    const idempotencyKey = this.buildIdempotencyKey(input);
    return idempotencyKey ? { idempotencyKey } : {};
  }

  buildConsecutiveFailureInput(
    input: EvaluateContinuationInput,
    failureClass?: FailureClass,
  ):
    | { consecutiveFailure: true; failureClass?: FailureClass }
    | Record<string, never> {
    if (input.consecutiveFailure !== true) {
      return {};
    }
    return failureClass === undefined
      ? { consecutiveFailure: true }
      : { consecutiveFailure: true, failureClass };
  }
}
