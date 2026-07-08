import { useCallback, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { formatDistanceToNowSafe } from "@/lib/utils";
import { useProjectList } from "@/hooks/useProjects";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DataTable } from "@/components/ui/data-table/DataTable";
import type {
  ColumnDef,
  FilterDef,
  ListQuery,
  ListResponse,
} from "@/components/ui/data-table/data-table.types";
import { deriveLiveState } from "@/pages/kanban/kanban.utils";
import { WorkItemTypeBadge } from "@/features/kanban/work-item-type-badge";
import {
  WORK_ITEM_PRIORITY_OPTIONS,
  WORK_ITEM_STATUS_OPTIONS,
} from "@/lib/work-items/work-item-filter-options";
import type { WorkItemListQuery } from "@/lib/api/client.projects.types";
import { WorkItemLiveState } from "@/lib/api/work-items.types";
import type { WorkItemListRow } from "./GlobalWorkItemsPage.types";

const WORK_ITEMS_QUERY_KEY = "global-work-items";
const PROJECT_WORK_ITEMS_QUERY_KEY = "project-work-items";
const DEFAULT_PAGE_SIZE = 50;
const PROJECT_FILTER_KEY = "projectId";

interface DeleteWorkItemTarget {
  id: string;
  projectId: string;
  title: string;
}

function getLiveBadgeClass(state: WorkItemLiveState): string {
  switch (state) {
    case "running":
      return "bg-success text-success-foreground animate-pulse";
    case "queued":
      return "bg-amber-500 text-white animate-pulse";
    case "awaiting-input":
      return "bg-accent-purple text-white animate-pulse";
    case "error":
      return "bg-destructive text-destructive-foreground";
    case "blocked":
      return "bg-warning text-warning-foreground";
    case "completed":
      return "bg-secondary text-secondary-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function getPlanBadge(item: WorkItemListRow): {
  variant: "destructive" | "secondary" | "outline";
  label: "delta replan" | "planned" | "not planned";
} {
  if (item.executionConfig?.rejectionFeedback) {
    return { variant: "destructive", label: "delta replan" };
  }

  if (item.executionConfig?.implementationPlan) {
    return { variant: "secondary", label: "planned" };
  }

  return { variant: "outline", label: "not planned" };
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const SORT_FIELD_BY_COLUMN_KEY: Record<string, WorkItemListQuery["sortBy"]> = {
  title: "title",
  status: "status",
  priority: "priority",
  updatedAt: "updated_at",
  createdAt: "created_at",
  updated_at: "updated_at",
  created_at: "created_at",
};

function resolveSortField(
  sortBy: unknown,
): WorkItemListQuery["sortBy"] | undefined {
  return typeof sortBy === "string"
    ? SORT_FIELD_BY_COLUMN_KEY[sortBy]
    : undefined;
}

function useGlobalWorkItemDeletion() {
  const queryClient = useQueryClient();
  const [deletingItem, setDeletingItem] = useState<DeleteWorkItemTarget | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (variables: { projectId: string; workItemId: string }) =>
      api.deleteWorkItem(variables.projectId, variables.workItemId),
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: [WORK_ITEMS_QUERY_KEY] });
      void queryClient.invalidateQueries({
        queryKey: [PROJECT_WORK_ITEMS_QUERY_KEY, variables.projectId],
      });

      setDeletingItem(null);
      setDeleteError(null);
    },
  });

  const closeDeleteDialog = () => {
    setDeletingItem(null);
    setDeleteError(null);
  };

  const openDeleteDialog = (item: WorkItemListRow) => {
    setDeleteError(null);
    setDeletingItem({
      id: item.id,
      projectId: item.project_id,
      title: item.title,
    });
  };

  const handleDelete = async () => {
    if (!deletingItem) {
      return;
    }

    setDeleteError(null);
    try {
      await deleteMutation.mutateAsync({
        projectId: deletingItem.projectId,
        workItemId: deletingItem.id,
      });
    } catch (error) {
      setDeleteError(getApiErrorMessage(error, "Failed to delete work item."));
    }
  };

  return {
    deletingItem,
    deleteError,
    deleteMutation,
    openDeleteDialog,
    closeDeleteDialog,
    handleDelete,
  };
}

function buildColumns(params: {
  projectNameById: Map<string, string>;
  onDeleteWorkItem: (item: WorkItemListRow) => void;
}): ColumnDef<WorkItemListRow>[] {
  const { projectNameById, onDeleteWorkItem } = params;

  return [
    {
      key: "title",
      label: "Title",
      sortable: true,
      render: (item) => (
        <Link
          to={`/projects/${item.project_id}/work-items/${item.id}/active-session`}
          className="font-medium hover:underline"
        >
          {item.title}
        </Link>
      ),
    },
    {
      key: "project_id",
      label: "Project",
      render: (item) => (
        <Link
          to={`/projects/${item.project_id}/board`}
          className="text-muted-foreground hover:underline"
        >
          {projectNameById.get(item.project_id) ?? "—"}
        </Link>
      ),
    },
    {
      key: "status",
      label: "Status",
      sortable: true,
      render: (item) => <StatusBadge status={item.status} />,
    },
    {
      key: "currentExecutionId",
      label: "Live",
      render: (item) => {
        const liveState = deriveLiveState(item);
        return (
          <Badge className={getLiveBadgeClass(liveState)}>{liveState}</Badge>
        );
      },
    },
    {
      key: "priority",
      label: "Priority",
      sortable: true,
      render: (item) => <Badge variant="secondary">{item.priority}</Badge>,
    },
    {
      key: "type",
      label: "Type",
      render: (item) => <WorkItemTypeBadge type={item.type} />,
    },
    {
      key: "dependsOn",
      label: "Dependencies",
      className: "text-xs text-muted-foreground",
      render: (item) =>
        `${item.dependsOn?.length ?? 0} depends on / ${
          item.blockers?.length ?? 0
        } blocked by`,
    },
    {
      key: "executionConfig",
      label: "Plan",
      render: (item) => {
        const planBadge = getPlanBadge(item);
        return <Badge variant={planBadge.variant}>{planBadge.label}</Badge>;
      },
    },
    {
      key: "updatedAt",
      label: "Updated",
      sortable: true,
      className: "text-xs text-muted-foreground",
      render: (item) => formatDistanceToNowSafe(item.updatedAt, "—"),
    },
    {
      key: "id",
      label: "Actions",
      className: "text-right",
      render: (item) => (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Delete work item"
          onClick={() => {
            onDeleteWorkItem(item);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];
}

function buildFilters(
  projectOptions: { value: string; label: string }[],
): FilterDef[] {
  return [
    {
      key: PROJECT_FILTER_KEY,
      label: "Project",
      type: "select",
      options: projectOptions,
    },
    {
      key: "status",
      label: "Status",
      type: "select",
      options: WORK_ITEM_STATUS_OPTIONS,
    },
    {
      key: "priority",
      label: "Priority",
      type: "select",
      options: WORK_ITEM_PRIORITY_OPTIONS,
    },
  ];
}

function DeleteWorkItemDialog(props: {
  deletingItem: DeleteWorkItemTarget | null;
  deleteError: string | null;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: () => Promise<void>;
}) {
  const { deletingItem, deleteError, isDeleting, onOpenChange, onDelete } =
    props;

  return (
    <AlertDialog open={deletingItem !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete work item?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes &quot;{deletingItem?.title}&quot; and
            cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {deleteError ? (
          <p className="text-sm text-destructive">{deleteError}</p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void onDelete();
            }}
            disabled={isDeleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {isDeleting ? "Deleting..." : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function GlobalWorkItemsPage() {
  const {
    deletingItem,
    deleteError,
    deleteMutation,
    openDeleteDialog,
    closeDeleteDialog,
    handleDelete,
  } = useGlobalWorkItemDeletion();

  const { data: projects = [] } = useProjectList();

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const project of projects) {
      map.set(project.id, project.name);
    }
    return map;
  }, [projects]);

  const projectOptions = useMemo(
    () =>
      projects.map((project) => ({ value: project.id, label: project.name })),
    [projects],
  );

  const columns = useMemo(
    () => buildColumns({ projectNameById, onDeleteWorkItem: openDeleteDialog }),
    [projectNameById, openDeleteDialog],
  );

  const filters = useMemo(() => buildFilters(projectOptions), [projectOptions]);

  const fetchFn = useCallback(
    async (
      q: ListQuery & Record<string, unknown>,
    ): Promise<ListResponse<WorkItemListRow>> => {
      const limit = q.limit;
      const query: WorkItemListQuery = {
        search: asOptionalString(q.search),
        status: asOptionalString(q.status),
        priority: asOptionalString(q.priority),
        projectId: asOptionalString(q[PROJECT_FILTER_KEY]),
        sortBy: resolveSortField(q.sortBy),
        sortDir: q.sortDir,
        limit,
        offset: (q.page - 1) * limit,
      };
      const { items, total } = await api.getAllWorkItems(query);
      return {
        data: items as WorkItemListRow[],
        meta: {
          pagination: {
            total,
            page: q.page,
            limit,
            totalPages: Math.ceil(total / limit) || 1,
          },
        },
      };
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">All Work Items</h2>
        <p className="text-sm text-muted-foreground">
          Search, sort, and filter work items across all projects
        </p>
      </div>

      <DataTable<WorkItemListRow>
        mode="server"
        urlKey="wi"
        queryKey={[WORK_ITEMS_QUERY_KEY]}
        fetchFn={fetchFn}
        columns={columns}
        filters={filters}
        defaultSort="updatedAt"
        defaultSortDir="desc"
        defaultLimit={DEFAULT_PAGE_SIZE}
        emptyMessage="No work items found."
      />

      <DeleteWorkItemDialog
        deletingItem={deletingItem}
        deleteError={deleteError}
        isDeleting={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) {
            closeDeleteDialog();
          }
        }}
        onDelete={handleDelete}
      />
    </div>
  );
}
