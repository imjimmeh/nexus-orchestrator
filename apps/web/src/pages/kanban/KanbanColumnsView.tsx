import { useMemo, useState } from "react";
import { Droppable } from "@hello-pangea/dnd";
import { ChevronDown, ChevronUp, Zap } from "lucide-react";
import { WorkItem, WorkItemStatus } from "@/lib/api/work-items.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useWorkItemHierarchy } from "@/features/kanban/use-work-item-hierarchy";
import { KANBAN_COLUMNS } from "./kanban.utils";
import { KanbanWorkItemCard } from "./KanbanWorkItemCard";
import { QuickCreateWorkItem } from "./QuickCreateWorkItem";

const COLUMN_WIP_LIMITS: Partial<Record<WorkItemStatus, number>> = {
  refinement: 8,
  "in-progress": 8,
  "in-review": 5,
};

function getWipBadgeVariant(
  count: number,
  limit?: number,
): "secondary" | "outline" | "destructive" {
  if (!limit) {
    return "secondary";
  }
  if (count > limit) {
    return "destructive";
  }
  if (count >= Math.floor(limit * 0.8)) {
    return "outline";
  }
  return "secondary";
}

interface FlatKanbanViewProps {
  projectId: string;
  grouped: Record<WorkItemStatus, WorkItem[]>;
  allItems: WorkItem[];
  automationStatuses: WorkItemStatus[];
  collapsedColumns: Record<WorkItemStatus, boolean>;
  detailItemId: string | null;
  failedItemId: string | null;
  isStatusUpdatePending: boolean;
  isCreatingWorkItem: boolean;
  onCreateWorkItem: (title: string) => void;
  onSelectDetailItem: (itemId: string) => void;
  onConfigureItem: (itemId: string) => void;
  onMoveItemToStatus: (itemId: string, status: WorkItemStatus) => void;
  onRetriggerItemExecution: (item: WorkItem) => void;
  onDeleteItem: (item: WorkItem) => void;
  onToggleColumn: (status: WorkItemStatus) => void;
  toDroppableId: (scope: string, status: WorkItemStatus) => string;
}

interface KanbanColumnCardProps extends FlatKanbanViewProps {
  status: WorkItemStatus;
  title: string;
}

interface WorkItemHierarchyRollupRowProps {
  item: WorkItem;
  columnChildrenCount: number;
  showRollup: boolean;
  isExpanded: boolean;
  toggleParentExpanded: (parentId: string) => void;
}

/**
 * Renders the toggle/count/points row beneath a hierarchy node's card. The
 * toggle and "N sub-items" count are gated solely on whether same-column
 * children exist; the points badge is gated solely on server-derived rollup
 * data being present. Either signal alone is enough for the row to render.
 */
function WorkItemHierarchyRollupRow(
  props: Readonly<WorkItemHierarchyRollupRowProps>,
) {
  const {
    item,
    columnChildrenCount,
    showRollup,
    isExpanded,
    toggleParentExpanded,
  } = props;
  const hasColumnChildren = columnChildrenCount > 0;

  return (
    <div className="flex items-center gap-2 pl-2 text-xs text-muted-foreground">
      {hasColumnChildren && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${item.title}`}
          onClick={() => {
            toggleParentExpanded(item.id);
          }}
        >
          {isExpanded ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
        </Button>
      )}
      {hasColumnChildren && (
        <span>
          {columnChildrenCount} sub-item
          {columnChildrenCount === 1 ? "" : "s"}
        </span>
      )}
      {showRollup && (
        <Badge variant="secondary">{item.rolledUpPoints ?? 0} pts</Badge>
      )}
    </div>
  );
}

interface WorkItemHierarchyNodeProps {
  item: WorkItem;
  childrenByParentId: Record<string, WorkItem[]>;
  collapsedParentIds: ReadonlySet<string>;
  toggleParentExpanded: (parentId: string) => void;
  draggableIndexById: Map<string, number>;
  detailItemId: string | null;
  failedItemId: string | null;
  isStatusUpdatePending: boolean;
  onSelectDetailItem: (itemId: string) => void;
  onConfigureItem: (itemId: string) => void;
  onMoveItemToStatus: (itemId: string, status: WorkItemStatus) => void;
  onRetriggerItemExecution: (item: WorkItem) => void;
  onDeleteItem: (item: WorkItem) => void;
}

/**
 * Renders a single work item plus its full descendant subtree (recursively),
 * so any depth of parent/child nesting (e.g. epic -> story -> task) renders
 * correctly rather than only the first level. The rollup number badge is
 * shown whenever the item has server-derived children/points, independent of
 * whether any of those children happen to sit in this same status column.
 * The expand/collapse toggle and "N sub-items" count only appear when there
 * ARE same-column children to hide — independent of whether the server has
 * populated the rollup fields. The row itself renders whenever either signal
 * is present, so a same-column child with no server-derived rollup data
 * still gets a visible, collapsible toggle instead of disappearing.
 */
function WorkItemHierarchyNode(props: Readonly<WorkItemHierarchyNodeProps>) {
  const {
    item,
    childrenByParentId,
    collapsedParentIds,
    toggleParentExpanded,
    draggableIndexById,
    detailItemId,
    failedItemId,
    isStatusUpdatePending,
    onSelectDetailItem,
    onConfigureItem,
    onMoveItemToStatus,
    onRetriggerItemExecution,
    onDeleteItem,
  } = props;
  const columnChildren = childrenByParentId[item.id] ?? [];
  const hasColumnChildren = columnChildren.length > 0;
  const isExpanded = !collapsedParentIds.has(item.id);
  const showRollup =
    item.hasChildren === true ||
    (item.rolledUpPoints !== null && item.rolledUpPoints !== undefined);

  return (
    <div className="space-y-1">
      <KanbanWorkItemCard
        item={item}
        index={draggableIndexById.get(item.id) ?? 0}
        detailItemId={detailItemId}
        failedItemId={failedItemId}
        isStatusUpdatePending={isStatusUpdatePending}
        onSelect={onSelectDetailItem}
        onConfigure={onConfigureItem}
        onMoveToStatus={onMoveItemToStatus}
        onRetriggerExecution={onRetriggerItemExecution}
        onDeleteItem={onDeleteItem}
      />
      {(showRollup || hasColumnChildren) && (
        <WorkItemHierarchyRollupRow
          item={item}
          columnChildrenCount={columnChildren.length}
          showRollup={showRollup}
          isExpanded={isExpanded}
          toggleParentExpanded={toggleParentExpanded}
        />
      )}
      {isExpanded && hasColumnChildren && (
        <div className="ml-4 space-y-2 border-l-2 border-border pl-2">
          {columnChildren.map((child) => (
            <WorkItemHierarchyNode
              key={child.id}
              item={child}
              childrenByParentId={childrenByParentId}
              collapsedParentIds={collapsedParentIds}
              toggleParentExpanded={toggleParentExpanded}
              draggableIndexById={draggableIndexById}
              detailItemId={detailItemId}
              failedItemId={failedItemId}
              isStatusUpdatePending={isStatusUpdatePending}
              onSelectDetailItem={onSelectDetailItem}
              onConfigureItem={onConfigureItem}
              onMoveItemToStatus={onMoveItemToStatus}
              onRetriggerItemExecution={onRetriggerItemExecution}
              onDeleteItem={onDeleteItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function KanbanColumnCard(props: Readonly<KanbanColumnCardProps>) {
  const {
    grouped,
    automationStatuses,
    collapsedColumns,
    detailItemId,
    failedItemId,
    isStatusUpdatePending,
    isCreatingWorkItem,
    onCreateWorkItem,
    onSelectDetailItem,
    onConfigureItem,
    onMoveItemToStatus,
    onRetriggerItemExecution,
    onDeleteItem,
    onToggleColumn,
    toDroppableId,
    status,
    title,
  } = props;
  const isCollapsed = collapsedColumns[status];
  const hasAutomation = automationStatuses.includes(status);
  const wipLimit = COLUMN_WIP_LIMITS[status];
  const itemCount = grouped[status].length;
  const { roots, childrenByParentId } = useWorkItemHierarchy(grouped[status]);
  const [collapsedParentIds, setCollapsedParentIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const toggleParentExpanded = (parentId: string) => {
    setCollapsedParentIds((current) => {
      const next = new Set(current);
      if (next.has(parentId)) {
        next.delete(parentId);
      } else {
        next.add(parentId);
      }
      return next;
    });
  };
  const draggableIndexById = useMemo(() => {
    const indexById = new Map<string, number>();
    let nextIndex = 0;
    // Depth-first walk mirrors the recursive render below: a collapsed
    // node's entire (arbitrarily deep) subtree is skipped, not just its
    // immediate children.
    const assignIndex = (item: WorkItem) => {
      indexById.set(item.id, nextIndex++);
      if (!collapsedParentIds.has(item.id)) {
        for (const child of childrenByParentId[item.id] ?? []) {
          assignIndex(child);
        }
      }
    };
    for (const root of roots) {
      assignIndex(root);
    }
    return indexById;
  }, [roots, childrenByParentId, collapsedParentIds]);

  return (
    <Card className="w-80 shrink-0 border-border/80 bg-card/85">
      <CardHeader className="space-y-2 border-b pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {title}
            {itemCount > 0 ? (
              <Badge variant="secondary" className="ml-2">
                {itemCount}
              </Badge>
            ) : null}
          </CardTitle>
          <div className="flex items-center gap-2">
            {wipLimit ? (
              <Badge variant={getWipBadgeVariant(itemCount, wipLimit)}>
                {itemCount}/{wipLimit}
              </Badge>
            ) : null}
            {hasAutomation ? (
              <Badge variant="outline" className="gap-1">
                <Zap className="h-3 w-3" />
                Automation
              </Badge>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                onToggleColumn(status);
              }}
            >
              {isCollapsed ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronUp className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </CardHeader>

      {isCollapsed ? null : (
        <CardContent>
          <Droppable droppableId={toDroppableId("flat", status)}>
            {(droppableProvided, snapshot) => (
              <div
                ref={droppableProvided.innerRef}
                {...droppableProvided.droppableProps}
                className={cn(
                  "min-h-[140px] space-y-2 rounded-md border border-dashed p-1 transition-colors",
                  snapshot.isDraggingOver
                    ? "border-primary bg-primary-50/50"
                    : "border-transparent",
                )}
              >
                {roots.map((item) => (
                  <WorkItemHierarchyNode
                    key={item.id}
                    item={item}
                    childrenByParentId={childrenByParentId}
                    collapsedParentIds={collapsedParentIds}
                    toggleParentExpanded={toggleParentExpanded}
                    draggableIndexById={draggableIndexById}
                    detailItemId={detailItemId}
                    failedItemId={failedItemId}
                    isStatusUpdatePending={isStatusUpdatePending}
                    onSelectDetailItem={onSelectDetailItem}
                    onConfigureItem={onConfigureItem}
                    onMoveItemToStatus={onMoveItemToStatus}
                    onRetriggerItemExecution={onRetriggerItemExecution}
                    onDeleteItem={onDeleteItem}
                  />
                ))}
                {status === "backlog" && (
                  <QuickCreateWorkItem
                    isPending={isCreatingWorkItem}
                    onSubmit={onCreateWorkItem}
                  />
                )}
                {droppableProvided.placeholder}
              </div>
            )}
          </Droppable>
        </CardContent>
      )}
    </Card>
  );
}

export function FlatKanbanView({
  projectId,
  grouped,
  allItems,
  automationStatuses,
  collapsedColumns,
  detailItemId,
  failedItemId,
  isStatusUpdatePending,
  isCreatingWorkItem,
  onCreateWorkItem,
  onSelectDetailItem,
  onConfigureItem,
  onMoveItemToStatus,
  onRetriggerItemExecution,
  onDeleteItem,
  onToggleColumn,
  toDroppableId,
}: Readonly<FlatKanbanViewProps>) {
  return (
    <div className="pb-2 min-w-full">
      <div className="flex min-w-max gap-4">
        {KANBAN_COLUMNS.map((column) => (
          <KanbanColumnCard
            key={column.status}
            {...{
              projectId,
              grouped,
              allItems,
              automationStatuses,
              collapsedColumns,
              detailItemId,
              failedItemId,
              isStatusUpdatePending,
              isCreatingWorkItem,
              onCreateWorkItem,
              onSelectDetailItem,
              onConfigureItem,
              onMoveItemToStatus,
              onRetriggerItemExecution,
              onDeleteItem,
              onToggleColumn,
              toDroppableId,
            }}
            status={column.status}
            title={column.title}
          />
        ))}
      </div>
    </div>
  );
}
