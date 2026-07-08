import { WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
import { TaskConfigModal } from "./TaskConfigModal";
import { CreateWorkItemModal } from "./CreateWorkItemModal";
import { WorkItemDetailSheet } from "./WorkItemDetailSheet";
import { DeleteWorkItemDialog } from "./DeleteWorkItemDialog";
import type {
  useKanbanBoardActions,
  useKanbanBoardQueries,
} from "./useKanbanBoardData";
import type { useDeleteWorkItemFlow } from "./work-item-detail-sheet.hooks";

type KanbanDetailAndConfigProps = {
  detailItemId: string | null;
  detailItem: WorkItem | null;
  items: WorkItem[];
  configWorkItemId: string | null;
  configWorkItem: WorkItem | null;
  currentExecutionConfig: WorkItem["executionConfig"] | null;
  agentProfiles: ReturnType<typeof useKanbanBoardQueries>["agentProfiles"];
  repositoryBranches: string[];
  repositoryFiles: string[];
  upsertExecutionConfig: ReturnType<
    typeof useKanbanBoardActions
  >["upsertExecutionConfig"];
  pendingStatusUpdate: { workItemId: string; status: WorkItemStatus } | null;
  updateStatus: ReturnType<typeof useKanbanBoardActions>["updateStatus"];
  cardDeleteFlow: ReturnType<typeof useDeleteWorkItemFlow>;
  onDetailOpenChange: (open: boolean) => void;
  onConfigOpenChange: (open: boolean) => void;
  onClearPendingStatusUpdate: () => void;
  isCreateModalOpen: boolean;
  setIsCreateModalOpen: (value: boolean) => void;
  createWorkItem: ReturnType<typeof useKanbanBoardActions>["createWorkItem"];
};

export function KanbanDetailAndConfig(
  props: Readonly<KanbanDetailAndConfigProps>,
) {
  const {
    detailItemId,
    detailItem,
    items,
    configWorkItemId,
    configWorkItem,
    currentExecutionConfig,
    agentProfiles,
    repositoryBranches,
    repositoryFiles,
    upsertExecutionConfig,
    pendingStatusUpdate,
    updateStatus,
    cardDeleteFlow,
    onDetailOpenChange,
    onConfigOpenChange,
    onClearPendingStatusUpdate,
    isCreateModalOpen,
    setIsCreateModalOpen,
    createWorkItem,
  } = props;

  return (
    <>
      <WorkItemDetailSheet
        item={detailItem}
        allItems={items}
        open={!!detailItemId}
        onOpenChange={onDetailOpenChange}
      />

      <TaskConfigModal
        open={!!configWorkItemId}
        onOpenChange={onConfigOpenChange}
        workItemTitle={configWorkItem?.title}
        agentProfiles={agentProfiles}
        branches={repositoryBranches}
        files={repositoryFiles}
        initialConfig={
          currentExecutionConfig || configWorkItem?.executionConfig || null
        }
        isSaving={upsertExecutionConfig.isPending}
        onSave={async (config) => {
          if (!configWorkItemId) {
            return;
          }

          const savedWorkItem = await upsertExecutionConfig.mutateAsync({
            workItemId: configWorkItemId,
            config,
          });

          const queued = pendingStatusUpdate;
          onConfigOpenChange(false);
          onClearPendingStatusUpdate();

          if (queued?.workItemId && savedWorkItem.id === queued.workItemId) {
            updateStatus.mutate({
              workItemId: queued.workItemId,
              status: queued.status,
              bypassReadinessGates: true,
            });
          }
        }}
      />

      <CreateWorkItemModal
        open={isCreateModalOpen}
        onOpenChange={(open) => {
          if (!open) setIsCreateModalOpen(false);
        }}
        isPending={createWorkItem.isPending}
        items={items}
        onSubmit={(data) =>
          createWorkItem.mutate(data, {
            onSuccess: () => setIsCreateModalOpen(false),
          })
        }
      />

      {cardDeleteFlow.pendingDeleteItem ? (
        <DeleteWorkItemDialog
          item={cardDeleteFlow.pendingDeleteItem}
          isOpen={cardDeleteFlow.isDeleteDialogOpen}
          errorMessage={cardDeleteFlow.deleteError}
          isDeleting={cardDeleteFlow.deleteMutation.isPending}
          onOpenChange={cardDeleteFlow.handleDialogOpenChange}
          onDelete={cardDeleteFlow.handleDelete}
        />
      ) : null}
    </>
  );
}
