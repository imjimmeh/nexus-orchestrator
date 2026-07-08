import { WorkItem } from "@/lib/api/work-items.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { WorkItemReadOnlyContent } from "./WorkItemDetailSheetContent";
import { WorkItemEditContent } from "./WorkItemEditSections";
import type { useWorkItemFormState } from "./work-item-detail-sheet.hooks";

interface WorkItemDetailPanelProps {
  item: WorkItem;
  allItems: WorkItem[];
  formState: ReturnType<typeof useWorkItemFormState>;
  canMerge: boolean;
  canRestartExecution: boolean;
  hasActiveSession: boolean;
  mergeStatus: string | null;
  mergeReason: string | null;
  runs: {
    currentRun: WorkflowRun | null | undefined;
    isCurrentRunLoading: boolean;
    executionHistory: WorkflowRun[];
    isLoadingExecutionHistory: boolean;
  };
  isSaving: boolean;
  hasSaveError: boolean;
  isRestartingExecution: boolean;
  isDeleting: boolean;
  onSave: () => void;
  onCancel: () => void;
  onOpenActiveSession: () => void;
  onOpenCurrentRun: () => void;
  onOpenHistoryRun: (run: WorkflowRun) => void;
  onOpenMerge: () => void;
  onRestartExecution: () => void;
  onDelete: () => void;
  onResolveFeedback: (response: string) => void;
}

export function WorkItemDetailPanel(props: Readonly<WorkItemDetailPanelProps>) {
  const {
    item,
    allItems,
    formState,
    canMerge,
    canRestartExecution,
    hasActiveSession,
    mergeStatus,
    mergeReason,
    runs,
    isSaving,
    hasSaveError,
    isRestartingExecution,
    isDeleting,
    onSave,
    onCancel,
    onOpenActiveSession,
    onOpenCurrentRun,
    onOpenHistoryRun,
    onOpenMerge,
    onRestartExecution,
    onDelete,
    onResolveFeedback,
  } = props;

  if (formState.isEditing) {
    return (
      <WorkItemEditContent
        currentItemId={item.id}
        allItems={allItems}
        title={formState.title}
        description={formState.description}
        priority={formState.priority}
        dependencyIds={formState.dependencyIds}
        type={formState.type}
        parentWorkItemId={formState.parentWorkItemId}
        storyPoints={formState.storyPoints}
        errors={formState.errors}
        isSaving={isSaving}
        hasError={hasSaveError}
        onTitleChange={formState.setTitle}
        onDescriptionChange={formState.setDescription}
        onPriorityChange={formState.setPriority}
        onDependencyIdsChange={formState.setDependencyIds}
        onTypeChange={formState.setType}
        onParentWorkItemIdChange={formState.setParentWorkItemId}
        onStoryPointsChange={formState.setStoryPoints}
        onSave={onSave}
        onCancel={onCancel}
      />
    );
  }

  return (
    <WorkItemReadOnlyContent
      item={item}
      allItems={allItems}
      hasActiveSession={hasActiveSession}
      canMerge={canMerge}
      canRestartExecution={canRestartExecution}
      isEditing={formState.isEditing}
      isRestartingExecution={isRestartingExecution}
      isDeleting={isDeleting}
      currentRun={runs.currentRun}
      isCurrentRunLoading={runs.isCurrentRunLoading}
      executionHistory={runs.executionHistory}
      isLoadingExecutionHistory={runs.isLoadingExecutionHistory}
      mergeStatus={mergeStatus}
      mergeReason={mergeReason}
      onStartEditing={() => {
        formState.setIsEditing(true);
      }}
      onOpenActiveSession={onOpenActiveSession}
      onOpenCurrentRun={onOpenCurrentRun}
      onOpenHistoryRun={onOpenHistoryRun}
      onOpenMerge={onOpenMerge}
      onRestartExecution={onRestartExecution}
      onDelete={onDelete}
      onResolveFeedback={onResolveFeedback}
    />
  );
}
