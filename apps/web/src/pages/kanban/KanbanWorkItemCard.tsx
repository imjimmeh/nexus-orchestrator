import { useMemo, useState, type CSSProperties } from "react";
import { Draggable } from "@hello-pangea/dnd";
import { cn } from "@/lib/utils";
import { WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
import {
  canRestartWorkItemExecution,
  deriveLiveState,
  getAllowedStatusTransitions,
  getKanbanColumnTitle,
} from "./kanban.utils";
import { deriveGateState } from "./kanban-gate-state";
import {
  getPriorityBorderClass,
  getStatusProgress,
  parseDecisionMetadata,
} from "./kanban-card-ui";
import { KanbanWorkItemCardBody } from "./KanbanWorkItemCardBody";
import { KanbanWorkItemContextMenu } from "./KanbanWorkItemContextMenu";

function getAutoCompletedReason(item: WorkItem): string | null {
  const metadataRecord =
    item.metadata && typeof item.metadata === "object" ? item.metadata : null;

  return metadataRecord &&
    typeof metadataRecord.autoCompletedReason === "string"
    ? metadataRecord.autoCompletedReason
    : null;
}

interface KanbanWorkItemCardProps {
  item: WorkItem;
  index: number;
  detailItemId: string | null;
  failedItemId: string | null;
  onSelect: (itemId: string) => void;
  onConfigure: (itemId: string) => void;
  onMoveToStatus: (itemId: string, status: WorkItemStatus) => void;
  onRetriggerExecution: (item: WorkItem) => void;
  onDeleteItem: (item: WorkItem) => void;
  isStatusUpdatePending: boolean;
}

export function KanbanWorkItemCard({
  item,
  index,
  detailItemId,
  failedItemId,
  onSelect,
  onConfigure,
  onMoveToStatus,
  onRetriggerExecution,
  onDeleteItem,
  isStatusUpdatePending,
}: Readonly<KanbanWorkItemCardProps>) {
  const [contextMenuPosition, setContextMenuPosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const liveState = failedItemId === item.id ? "error" : deriveLiveState(item);
  const hasActiveSession =
    item.lastExecutionStatus === "RUNNING" ||
    item.lastExecutionStatus === "PENDING";
  const autoCompletedReason = getAutoCompletedReason(item);
  const decisionMetadata = parseDecisionMetadata(item.metadata);
  const dependencyCount = item.dependsOn?.length ?? 0;
  const blockerCount = item.blockers?.length ?? 0;
  let planState = "not planned";
  if (item.executionConfig?.rejectionFeedback) {
    planState = "delta replan";
  } else if (item.executionConfig?.implementationPlan) {
    planState = "planned";
  }
  const progressPercent = getStatusProgress(item.status);
  const gateState = deriveGateState(item, isStatusUpdatePending);
  const moveToOptions = useMemo(
    () =>
      getAllowedStatusTransitions(item.status).map((status) => ({
        status,
        label: getKanbanColumnTitle(status),
      })),
    [item.status],
  );

  return (
    <>
      <Draggable
        draggableId={item.id}
        index={index}
        key={item.id}
        disableInteractiveElementBlocking
      >
        {(draggableProvided) => (
          <div
            ref={draggableProvided.innerRef}
            {...draggableProvided.draggableProps}
            // @hello-pangea/dnd's DraggableStyle lacks the `--radix-*` index
            // signature that Radix adds to React.CSSProperties; cast back so
            // the dnd-managed style satisfies the augmented prop type.
            style={draggableProvided.draggableProps.style as CSSProperties}
            className={cn(
              "relative cursor-grab rounded-md border border-l-4 bg-background p-3 text-sm shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md active:cursor-grabbing",
              detailItemId === item.id && "ring-2 ring-primary",
              hasActiveSession && "border-l-4 border-l-green-500",
              !hasActiveSession && getPriorityBorderClass(item.priority),
            )}
            onContextMenuCapture={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setContextMenuPosition({ x: event.clientX, y: event.clientY });
            }}
          >
            <button
              type="button"
              aria-label={`Open details for ${item.title}`}
              className="absolute inset-0 rounded-md"
              {...draggableProvided.dragHandleProps}
              onClick={() => {
                onSelect(item.id);
              }}
            />
            <div className="pointer-events-none relative z-10">
              <KanbanWorkItemCardBody
                item={item}
                liveState={liveState}
                autoCompletedReason={autoCompletedReason}
                blockerCount={blockerCount}
                dependencyCount={dependencyCount}
                planState={planState}
                progressPercent={progressPercent}
                hasActiveSession={hasActiveSession}
                decisionMetadata={decisionMetadata}
                gateState={gateState}
                onConfigure={onConfigure}
              />
            </div>
          </div>
        )}
      </Draggable>
      <KanbanWorkItemContextMenu
        open={contextMenuPosition !== null}
        cursorPosition={contextMenuPosition}
        moveToOptions={moveToOptions}
        canRetrigger={canRestartWorkItemExecution(item)}
        disabled={isStatusUpdatePending}
        onMoveTo={(nextStatus) => {
          onMoveToStatus(item.id, nextStatus);
        }}
        onRetrigger={() => {
          onRetriggerExecution(item);
        }}
        onDelete={() => {
          onDeleteItem(item);
        }}
        onClose={() => {
          setContextMenuPosition(null);
        }}
      />
    </>
  );
}
