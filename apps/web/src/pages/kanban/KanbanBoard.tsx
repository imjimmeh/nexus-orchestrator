import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useParams } from "react-router-dom";
import { DragDropContext, type DropResult } from "@hello-pangea/dnd";
import { WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  groupWorkItemsByDependencyReadiness,
  groupWorkItemsByStatus,
  getAllowedStatusTransitions,
  type WorkItemReadinessGroup,
} from "./kanban.utils";
import { KanbanDetailAndConfig } from "./KanbanDetailAndConfig";
import { useKanbanCardActions } from "./useKanbanCardActions";
import { KanbanStatusAlert, ReadinessFilterBar } from "./KanbanBoardControls";
import {
  createDroppableId,
  getInitialCollapsedColumns,
  parseStatusFromDroppableId,
} from "./kanban.board-helpers";
import { FlatKanbanView } from "./KanbanColumnsView";
import {
  useKanbanBoardActions,
  useKanbanBoardQueries,
} from "./useKanbanBoardData";
import { filterWorkItems, useWorkItemFilters } from "./useWorkItemFilters";
import type { WorkItemFilterState } from "./useWorkItemFilters.types";
import { WorkItemFilterToolbar } from "./WorkItemFilterToolbar";
import {KanbanStatusNotice} from "./types";
import { ErrorBoundary } from "@/components/error-boundary/ErrorBoundary";

type ReadinessFilter = "all" | WorkItemReadinessGroup;

function shouldOpenExecutionConfig(status: WorkItemStatus): boolean {
  return (
    status === "todo" || status === "refinement" || status === "in-progress"
  );
}

function createHandleStatusChange(params: {
  items: WorkItem[];
  setConfigWorkItemId: (id: string | null) => void;
  setPendingStatusUpdate: (
    update: { workItemId: string; status: WorkItemStatus } | null,
  ) => void;
  setStatusNotice: (notice: KanbanStatusNotice | null) => void;
  updateStatus: {
    mutate: (variables: {
      workItemId: string;
      status: WorkItemStatus;
      bypassReadinessGates?: boolean;
    }) => void;
  };
}) {
  const {
    items,
    setConfigWorkItemId,
    setPendingStatusUpdate,
    setStatusNotice,
    updateStatus,
  } = params;

  return (workItemId: string, nextStatus: WorkItemStatus) => {
    const item = items.find((entry) => entry.id === workItemId);
    if (!item || item.status === nextStatus) {
      return;
    }

    const allowedTargets = getAllowedStatusTransitions(item.status);
    if (!allowedTargets.includes(nextStatus)) {
      setStatusNotice({
        kind: "error",
        message: `Cannot move ${item.status} work item directly to ${nextStatus}. Allowed targets: ${allowedTargets.join(", ")}.`,
      });
      return;
    }

    if (shouldOpenExecutionConfig(nextStatus) && !item.executionConfig) {
      setConfigWorkItemId(item.id);
      setPendingStatusUpdate({ workItemId: item.id, status: nextStatus });
      return;
    }

    updateStatus.mutate({
      workItemId: item.id,
      status: nextStatus,
      bypassReadinessGates: true,
    });
  };
}

function createHandleDragEnd(params: {
  onStatusChange: (workItemId: string, nextStatus: WorkItemStatus) => void;
}) {
  const { onStatusChange } = params;

  return (result: DropResult) => {
    if (!result.destination) {
      return;
    }

    const nextStatus = parseStatusFromDroppableId(
      result.destination.droppableId,
    );
    if (!nextStatus) {
      return;
    }

    onStatusChange(result.draggableId, nextStatus);
  };
}

type KanbanBoardContentProps = {
  projectId: string;
  items: WorkItem[];
  grouped: ReturnType<typeof groupWorkItemsByStatus>;
  automationStatuses: ReturnType<
    typeof useKanbanBoardQueries
  >["automationStatuses"];
  collapsedColumns: Record<WorkItemStatus, boolean>;
  detailItemId: string | null;
  failedItemId: string | null;
  isStatusUpdatePending: boolean;
  statusNotice: KanbanStatusNotice | null;
  filterCounts: Record<WorkItemReadinessGroup, number>;
  readinessFilter: ReadinessFilter;
  setReadinessFilter: (filter: ReadinessFilter) => void;
  filters: WorkItemFilterState;
  setFilter: (key: keyof WorkItemFilterState, value: string) => void;
  setDetailItemId: (id: string | null) => void;
  setConfigWorkItemId: (id: string | null) => void;
  setPendingStatusUpdate: (
    update: { workItemId: string; status: WorkItemStatus } | null,
  ) => void;
  setCollapsedColumns: Dispatch<
    SetStateAction<Record<WorkItemStatus, boolean>>
  >;
  onMoveItemToStatus: (itemId: string, status: WorkItemStatus) => void;
  onRetriggerItemExecution: (item: WorkItem) => void;
  onDeleteItem: (item: WorkItem) => void;
  handleDragEnd: (result: DropResult) => void;
  onCreateClick: () => void;
  isCreatingWorkItem: boolean;
  onCreateWorkItem: (title: string) => void;
};

function KanbanBoardContent(props: Readonly<KanbanBoardContentProps>) {
  const {
    projectId,
    items,
    grouped,
    automationStatuses,
    collapsedColumns,
    detailItemId,
    failedItemId,
    isStatusUpdatePending,
    statusNotice,
    filterCounts,
    readinessFilter,
    setReadinessFilter,
    filters,
    setFilter,
    setDetailItemId,
    setConfigWorkItemId,
    setPendingStatusUpdate,
    setCollapsedColumns,
    onMoveItemToStatus,
    onRetriggerItemExecution,
    onDeleteItem,
    handleDragEnd,
    onCreateClick,
    isCreatingWorkItem,
    onCreateWorkItem,
  } = props;

  return (
    <div className="space-y-4">
      <ReadinessFilterBar
        readinessFilter={readinessFilter}
        itemsCount={items.length}
        filterCounts={filterCounts}
        onReadinessFilterChange={setReadinessFilter}
        onCreateClick={onCreateClick}
      />

      <WorkItemFilterToolbar filters={filters} onChange={setFilter} />

      {statusNotice && <KanbanStatusAlert statusNotice={statusNotice} />}

      <DragDropContext onDragEnd={handleDragEnd}>
        <FlatKanbanView
          projectId={projectId}
          grouped={grouped}
          allItems={items}
          automationStatuses={automationStatuses}
          collapsedColumns={collapsedColumns}
          detailItemId={detailItemId}
          failedItemId={failedItemId}
          isStatusUpdatePending={isStatusUpdatePending}
          isCreatingWorkItem={isCreatingWorkItem}
          onCreateWorkItem={onCreateWorkItem}
          onSelectDetailItem={setDetailItemId}
          onConfigureItem={(itemId) => {
            setConfigWorkItemId(itemId);
            setPendingStatusUpdate(null);
          }}
          onMoveItemToStatus={onMoveItemToStatus}
          onRetriggerItemExecution={onRetriggerItemExecution}
          onDeleteItem={onDeleteItem}
          onToggleColumn={(status) => {
            setCollapsedColumns((current) => ({
              ...current,
              [status]: !current[status],
            }));
          }}
          toDroppableId={createDroppableId}
        />
      </DragDropContext>
    </div>
  );
}

function useKanbanBoardState(projectId: string | undefined) {
  const [readinessFilter, setReadinessFilter] =
    useState<ReadinessFilter>("all");
  const [collapsedColumns, setCollapsedColumns] = useState<
    Record<WorkItemStatus, boolean>
  >(getInitialCollapsedColumns());
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [failedItemId, setFailedItemId] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<KanbanStatusNotice | null>(
    null,
  );
  const [configWorkItemId, setConfigWorkItemId] = useState<string | null>(null);
  const [pendingStatusUpdate, setPendingStatusUpdate] = useState<{
    workItemId: string;
    status: WorkItemStatus;
  } | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const {
    items,
    automationStatuses,
    agentProfiles,
    repositoryBranches,
    repositoryFiles,
    currentExecutionConfig,
  } = useKanbanBoardQueries(projectId, configWorkItemId);
  const { updateStatus, upsertExecutionConfig, createWorkItem } =
    useKanbanBoardActions({
      projectId,
      setFailedItemId,
      setStatusNotice,
    });

  const cardActions = useKanbanCardActions();

  const { filters, setFilter } = useWorkItemFilters();
  const filteredItems = useMemo(
    () => filterWorkItems(items, filters),
    [items, filters],
  );
  const readinessGroups = useMemo(
    () => groupWorkItemsByDependencyReadiness(filteredItems),
    [filteredItems],
  );
  const visibleItems = useMemo(
    () =>
      readinessFilter === "all"
        ? filteredItems
        : (readinessGroups.find((entry) => entry.key === readinessFilter)
            ?.items ?? []),
    [filteredItems, readinessFilter, readinessGroups],
  );
  const grouped = useMemo(
    () => groupWorkItemsByStatus(visibleItems),
    [visibleItems],
  );
  const filterCounts = useMemo(() => {
    const map: Record<WorkItemReadinessGroup, number> = {
      ready: 0,
      blocked: 0,
      "in-flight": 0,
      done: 0,
    };
    for (const group of readinessGroups) {
      map[group.key] = group.items.length;
    }
    return map;
  }, [readinessGroups]);
  const detailItem = useMemo(
    () => items.find((item) => item.id === detailItemId) || null,
    [items, detailItemId],
  );
  const configWorkItem = useMemo(
    () => items.find((item) => item.id === configWorkItemId) || null,
    [items, configWorkItemId],
  );
  const handleStatusChange = createHandleStatusChange({
    items,
    setConfigWorkItemId,
    setPendingStatusUpdate,
    setStatusNotice,
    updateStatus,
  });
  const handleDragEnd = createHandleDragEnd({
    onStatusChange: handleStatusChange,
  });

  return {
    readinessFilter,
    setReadinessFilter,
    filters,
    setFilter,
    collapsedColumns,
    setCollapsedColumns,
    detailItemId,
    setDetailItemId,
    failedItemId,
    statusNotice,
    configWorkItemId,
    setConfigWorkItemId,
    pendingStatusUpdate,
    setPendingStatusUpdate,
    items,
    automationStatuses,
    agentProfiles,
    repositoryBranches,
    repositoryFiles,
    currentExecutionConfig,
    updateStatus,
    upsertExecutionConfig,
    createWorkItem,
    grouped,
    filterCounts,
    detailItem,
    configWorkItem,
    handleStatusChange,
    cardActions,
    handleDragEnd,
    isCreateModalOpen,
    setIsCreateModalOpen,
  };
}

export function KanbanBoard() {
  const { projectId } = useParams<{ projectId: string }>();
  const state = useKanbanBoardState(projectId);

  if (!projectId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Kanban Board</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Project id is required.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <ErrorBoundary>
        <KanbanBoardContent
          projectId={projectId}
          items={state.items}
          grouped={state.grouped}
          automationStatuses={state.automationStatuses}
          collapsedColumns={state.collapsedColumns}
          detailItemId={state.detailItemId}
          failedItemId={state.failedItemId}
          isStatusUpdatePending={state.updateStatus.isPending}
          statusNotice={state.statusNotice}
          filterCounts={state.filterCounts}
          readinessFilter={state.readinessFilter}
          setReadinessFilter={state.setReadinessFilter}
          filters={state.filters}
          setFilter={state.setFilter}
          setDetailItemId={state.setDetailItemId}
          setConfigWorkItemId={state.setConfigWorkItemId}
          setPendingStatusUpdate={state.setPendingStatusUpdate}
          setCollapsedColumns={state.setCollapsedColumns}
          onMoveItemToStatus={state.handleStatusChange}
          onRetriggerItemExecution={state.cardActions.retriggerItemExecution}
          onDeleteItem={state.cardActions.deleteItem}
          handleDragEnd={state.handleDragEnd}
          onCreateClick={() => state.setIsCreateModalOpen(true)}
          isCreatingWorkItem={state.createWorkItem.isPending}
          onCreateWorkItem={(title) =>
            state.createWorkItem.mutate({ title, priority: "p2" })
          }
        />
      </ErrorBoundary>

      <KanbanDetailAndConfig
        detailItemId={state.detailItemId}
        detailItem={state.detailItem}
        items={state.items}
        configWorkItemId={state.configWorkItemId}
        configWorkItem={state.configWorkItem}
        currentExecutionConfig={state.currentExecutionConfig}
        agentProfiles={state.agentProfiles}
        repositoryBranches={state.repositoryBranches}
        repositoryFiles={state.repositoryFiles}
        upsertExecutionConfig={state.upsertExecutionConfig}
        pendingStatusUpdate={state.pendingStatusUpdate}
        updateStatus={state.updateStatus}
        cardDeleteFlow={state.cardActions.deleteFlow}
        onDetailOpenChange={(open) => {
          if (!open) {
            state.setDetailItemId(null);
          }
        }}
        onConfigOpenChange={(open) => {
          if (!open) {
            state.setConfigWorkItemId(null);
            state.setPendingStatusUpdate(null);
          }
        }}
        onClearPendingStatusUpdate={() => {
          state.setPendingStatusUpdate(null);
        }}
        isCreateModalOpen={state.isCreateModalOpen}
        setIsCreateModalOpen={state.setIsCreateModalOpen}
        createWorkItem={state.createWorkItem}
      />
    </>
  );
}
