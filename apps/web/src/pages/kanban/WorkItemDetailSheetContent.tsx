import { type ReactNode } from "react";
import { WorkItem } from "@/lib/api/work-items.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { Badge } from "@/components/ui/badge";
import { WorkItemCostEstimatePanel } from "@/components/budget/WorkItemCostEstimatePanel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { WorkItemTypeBadge } from "@/features/kanban/work-item-type-badge";
import {
  AssignedAgentSection,
  DecisionMetadataSection,
  ExecutionIdSection,
  MergeStatusSection,
} from "./WorkItemDetailSections";
import { WorkItemActionButtons } from "./WorkItemActionButtons";
import { WorkItemQaFindingsPanel } from "./WorkItemQaFindingsPanel";
import { WorkItemPreflightSummarySection } from "./WorkItemPreflightSummarySection";
import { PlanReviewPanel } from "@/components/orchestration/PlanReviewPanel";
import { WorkflowStatusBadge } from "@/components/workflow/WorkflowStatusBadge";
import { getSplitRelationshipView } from "./work-item-split-relationships";
import type { SplitRelationshipRow } from "./work-item-split-relationships.types";

function resolveWorkItemLabel(itemId: string, allItems: WorkItem[]): string {
  const item = allItems.find((entry) => entry.id === itemId);
  if (!item) {
    return itemId;
  }

  return item.title;
}

function renderDependencySummary(params: {
  ids: string[] | undefined;
  allItems: WorkItem[];
  emptyMessage: string;
}): ReactNode {
  const { ids, allItems, emptyMessage } = params;
  const values = ids ?? [];
  if (values.length === 0) {
    return <p className="mt-1 text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <ul className="mt-1 space-y-1 text-sm">
      {values.map((id) => (
        <li key={id}>{resolveWorkItemLabel(id, allItems)}</li>
      ))}
    </ul>
  );
}

function renderSubtasks(item: WorkItem): ReactNode {
  const subtasks = item.subtasks ?? [];
  if (subtasks.length === 0) {
    return <p className="mt-1 text-sm text-muted-foreground">No subtasks.</p>;
  }

  const ordered = [...subtasks].sort((left, right) => {
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }
    return left.subtaskId.localeCompare(right.subtaskId);
  });

  const completedCount = ordered.filter(
    (subtask) => subtask.status === "done",
  ).length;

  return (
    <div className="mt-2 space-y-2">
      <p className="text-xs text-muted-foreground">
        {completedCount}/{ordered.length} completed
      </p>
      <ul className="space-y-2 text-sm">
        {ordered.map((subtask) => (
          <li key={subtask.id} className="rounded border px-2 py-1">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium">{subtask.title}</span>
              <Badge variant="outline">{subtask.status}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {subtask.subtaskId}
              {subtask.dependsOnSubtaskIds.length > 0
                ? ` · depends on ${subtask.dependsOnSubtaskIds.join(", ")}`
                : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderSplitRelationshipRow(row: SplitRelationshipRow): ReactNode {
  if (!row.item) {
    return (
      <li key={row.id} className="rounded border px-2 py-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{row.id}</span>
          <Badge variant="secondary">not currently loaded</Badge>
        </div>
      </li>
    );
  }

  return (
    <li key={row.id} className="rounded border px-2 py-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{row.item.title}</span>
        <Badge variant="outline">{row.item.status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">{row.id}</p>
    </li>
  );
}

function WorkItemSplitRelationshipSection({
  item,
  allItems,
}: Readonly<{ item: WorkItem; allItems: WorkItem[] }>): ReactNode {
  const relationshipView = getSplitRelationshipView(item, allItems);
  const hasParent = Boolean(relationshipView.parent);
  const hasChildren = relationshipView.children.length > 0;

  if (!hasParent && !hasChildren) {
    return null;
  }

  return (
    <div className="space-y-3">
      {hasChildren && (
        <div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-muted-foreground">
              Generated child work items
            </Label>
            <span className="text-xs text-muted-foreground">
              {relationshipView.childrenDone}/{relationshipView.childrenTotal}{" "}
              done
            </span>
          </div>
          <ul className="mt-2 space-y-2 text-sm">
            {relationshipView.children.map(renderSplitRelationshipRow)}
          </ul>
        </div>
      )}
      {relationshipView.parent && (
        <div>
          <Label className="text-muted-foreground">Parent umbrella</Label>
          <ul className="mt-2 space-y-2 text-sm">
            {renderSplitRelationshipRow(relationshipView.parent)}
          </ul>
        </div>
      )}
    </div>
  );
}

function buildWorkflowRunStatusContent(params: {
  currentExecutionId?: string | null;
  isCurrentRunLoading: boolean;
  currentRun?: WorkflowRun | null;
}): ReactNode {
  const { currentExecutionId, isCurrentRunLoading, currentRun } = params;
  if (!currentExecutionId) {
    return null;
  }
  if (isCurrentRunLoading) {
    return (
      <p className="text-xs text-muted-foreground">
        Loading workflow run status...
      </p>
    );
  }
  if (currentRun) {
    return (
      <div className="inline-flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Workflow:</span>
        <WorkflowStatusBadge status={currentRun.status} />
      </div>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">
      No workflow run record found for this execution id.
    </p>
  );
}
function renderExecutionHistoryContent(params: {
  isLoadingExecutionHistory: boolean;
  executionHistory: WorkflowRun[];
  onOpenRun: (run: WorkflowRun) => void;
}): ReactNode {
  const { isLoadingExecutionHistory, executionHistory, onOpenRun } = params;
  if (isLoadingExecutionHistory) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        Loading execution history...
      </p>
    );
  }
  if (executionHistory.length === 0) {
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        No linked workflow runs yet.
      </p>
    );
  }
  return (
    <div className="mt-2 space-y-2">
      {executionHistory.slice(0, 6).map((run) => (
        <div
          key={run.id}
          className="flex items-center justify-between rounded border px-2 py-1"
        >
          <div>
            <p className="text-xs font-mono">{run.id.slice(0, 8)}...</p>
            <p className="text-[11px] text-muted-foreground">
              {run.current_step_id || "-"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <WorkflowStatusBadge status={run.status} />
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onOpenRun(run);
              }}
            >
              Open
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function WorkItemDependencySections(
  props: Readonly<{
    item: WorkItem;
    allItems: WorkItem[];
  }>,
) {
  const { item, allItems } = props;

  return (
    <>
      <div>
        <Label className="text-muted-foreground">Depends On</Label>
        {renderDependencySummary({
          ids: item.dependsOn,
          allItems,
          emptyMessage: "No dependencies.",
        })}
      </div>
      <div>
        <Label className="text-muted-foreground">Blocked By (unmet)</Label>
        {renderDependencySummary({
          ids: item.blockers,
          allItems,
          emptyMessage: "No unmet blockers.",
        })}
      </div>
      <div>
        <Label className="text-muted-foreground">Blocks</Label>
        {renderDependencySummary({
          ids: item.blocks,
          allItems,
          emptyMessage: "No blocking dependents.",
        })}
      </div>
    </>
  );
}

interface WorkItemReadOnlyContentProps {
  item: WorkItem;
  allItems: WorkItem[];
  hasActiveSession: boolean;
  canMerge: boolean;
  canRestartExecution: boolean;
  isEditing: boolean;
  isRestartingExecution: boolean;
  isDeleting: boolean;
  currentRun: WorkflowRun | null | undefined;
  isCurrentRunLoading: boolean;
  executionHistory: WorkflowRun[];
  isLoadingExecutionHistory: boolean;
  mergeStatus: string | null;
  mergeReason: string | null;
  onStartEditing: () => void;
  onOpenActiveSession: () => void;
  onOpenCurrentRun: () => void;
  onOpenHistoryRun: (run: WorkflowRun) => void;
  onOpenMerge: () => void;
  onRestartExecution: () => void;
  onDelete: () => void;
  onResolveFeedback: (response: string) => void;
}

export function WorkItemReadOnlyContent({
  item,
  allItems,
  hasActiveSession,
  canMerge,
  canRestartExecution,
  isEditing,
  isRestartingExecution,
  isDeleting,
  currentRun,
  isCurrentRunLoading,
  executionHistory,
  isLoadingExecutionHistory,
  mergeStatus,
  mergeReason,
  onStartEditing,
  onOpenActiveSession,
  onOpenCurrentRun,
  onOpenHistoryRun,
  onOpenMerge,
  onRestartExecution,
  onDelete,
  onResolveFeedback,
}: Readonly<WorkItemReadOnlyContentProps>) {
  const workflowRunStatusContent = buildWorkflowRunStatusContent({
    currentExecutionId: item.currentExecutionId,
    isCurrentRunLoading,
    currentRun,
  });
  return (
    <>
      <WorkItemActionButtons
        isEditing={isEditing}
        hasActiveSession={hasActiveSession}
        hasCurrentRun={Boolean(currentRun)}
        canMerge={canMerge}
        canRestartExecution={canRestartExecution}
        isRestartingExecution={isRestartingExecution}
        isDeleting={isDeleting}
        onStartEditing={onStartEditing}
        onOpenActiveSession={onOpenActiveSession}
        onOpenCurrentRun={onOpenCurrentRun}
        onOpenMerge={onOpenMerge}
        onRestartExecution={onRestartExecution}
        onDelete={onDelete}
      />
      <div>
        <Label className="text-muted-foreground">Title</Label>
        <p className="mt-1 font-medium">{item.title}</p>
      </div>
      <div>
        <Label className="text-muted-foreground">Description</Label>
        <p className="mt-1 text-sm">{item.description || "No description"}</p>
      </div>
      <WorkItemPreflightSummarySection item={item} />
      <div className="flex gap-4">
        <div>
          <Label className="text-muted-foreground">Priority</Label>
          <div className="mt-1">
            <Badge variant="outline" className="uppercase">
              {item.priority}
            </Badge>
          </div>
        </div>
        <div>
          <Label className="text-muted-foreground">Type</Label>
          <div className="mt-1">
            <WorkItemTypeBadge type={item.type} />
          </div>
        </div>
      </div>
      <WorkItemDependencySections item={item} allItems={allItems} />
      <WorkItemSplitRelationshipSection item={item} allItems={allItems} />
      <div>
        <Label className="text-muted-foreground">Subtasks</Label>
        {renderSubtasks(item)}
      </div>
      <AssignedAgentSection assignedAgentId={item.assignedAgentId} />
      <ExecutionIdSection
        executionId={item.currentExecutionId}
        workflowRunStatusContent={workflowRunStatusContent}
      />
      <div>
        <Label className="text-muted-foreground">Execution History</Label>
        {renderExecutionHistoryContent({
          isLoadingExecutionHistory,
          executionHistory,
          onOpenRun: onOpenHistoryRun,
        })}
      </div>
      <MergeStatusSection mergeStatus={mergeStatus} mergeReason={mergeReason} />
      <DecisionMetadataSection
        metadata={item.metadata}
        onResolveFeedback={onResolveFeedback}
      />
      <div className="flex gap-8">
        <div>
          <Label className="text-muted-foreground">Token Spend</Label>
          <p className="mt-1 text-sm">{item.tokenSpend ?? 0}</p>
        </div>
        {(item.costCents ?? 0) > 0 && (
          <div>
            <Label className="text-muted-foreground">Estimated Cost</Label>
            <p className="mt-1 text-sm">
              ${((item.costCents ?? 0) / 100).toFixed(2)}
            </p>
          </div>
        )}
      </div>
      <WorkItemCostEstimatePanel
        projectId={item.project_id}
        workItemId={item.id}
      />
      {item.executionConfig?.implementationPlan ? (
        <PlanReviewPanel item={item} />
      ) : (
        <WorkItemQaFindingsPanel item={item} />
      )}
    </>
  );
}
