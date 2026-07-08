import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { WORKFLOW_SORT_COLUMNS, type WorkflowSortColumn } from "@nexus/core";
import { useDeleteWorkflow } from "@/hooks/useWorkflows";
import { Workflow } from "@/lib/api/workflows.types";
import { api } from "@/lib/api/client";
import { queryKeys } from "@/lib/queryKeys";
import { WorkflowLaunchDialog } from "@/components/workflow/WorkflowLaunchDialog";
import { DataTable } from "@/components/ui/data-table";
import type { ColumnDef, ListResponse } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { formatDateSafe } from "@/lib/utils";
import { useScopeContext } from "@/context/ScopeContext";
import { GLOBAL_SCOPE_NODE_ID } from "@/lib/api/client.scope.types";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

function WorkflowNotice({
  notice,
}: Readonly<{
  notice: {
    type: "success" | "error";
    title: string;
    message: string;
  };
}>) {
  return (
    <div className="p-4 border-b">
      <Alert variant={notice.type === "error" ? "destructive" : "default"}>
        {notice.type === "error" ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        <AlertTitle>{notice.title}</AlertTitle>
        <AlertDescription>{notice.message}</AlertDescription>
      </Alert>
    </div>
  );
}

const IS_ACTIVE_FILTER = {
  key: "isActive",
  label: "Status",
  type: "select" as const,
  options: [
    { label: "Active", value: "true" },
    { label: "Inactive", value: "false" },
  ],
};

function toWorkflowSortColumn(value: unknown): WorkflowSortColumn | undefined {
  return typeof value === "string" &&
    (WORKFLOW_SORT_COLUMNS as readonly string[]).includes(value)
    ? (value as WorkflowSortColumn)
    : undefined;
}

async function fetchWorkflowsPage(
  query: Record<string, unknown>,
  scopeNodeId: string,
): Promise<ListResponse<Workflow>> {
  const { isActive: isActiveFilter, ...rest } = query;
  const page = (rest.page as number) || 1;
  const limit = (rest.limit as number) || 20;

  const offset = (page - 1) * limit;
  const response = await api.getWorkflowsPage({
    limit,
    offset,
    search: rest.search as string | undefined,
    sortBy: toWorkflowSortColumn(rest.sortBy),
    sortDir: rest.sortDir as "asc" | "desc" | undefined,
    includeInactive: isActiveFilter === undefined,
    isActive:
      isActiveFilter === "true"
        ? true
        : isActiveFilter === "false"
          ? false
          : undefined,
    scopeNodeId,
  });

  const total = response.meta?.pagination?.total ?? response.data.length;

  return {
    data: response.data,
    meta: {
      pagination: {
        total,
        page,
        limit,
        totalPages:
          response.meta?.pagination?.totalPages ??
          (Math.ceil(total / limit) || 1),
      },
    },
  };
}

interface WorkflowColumnHandlers {
  onExecute: (workflow: Workflow) => void;
  onEdit: (workflowId: string) => void;
  onDelete: (workflow: { id: string; name: string }) => void;
}

function buildWorkflowColumns({
  onExecute,
  onEdit,
  onDelete,
}: WorkflowColumnHandlers): ColumnDef<Workflow>[] {
  return [
    {
      key: "name",
      label: "Name",
      sortable: true,
    },
    {
      key: "scope" as keyof Workflow,
      label: "Scope",
      render: (_workflow: Workflow) => "—",
    },
    {
      key: "is_active",
      label: "Status",
      sortable: true,
      render: (workflow) => (
        <Badge variant={workflow.is_active ? "default" : "secondary"}>
          {workflow.is_active ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      key: "created_at",
      label: "Created",
      sortable: true,
      render: (workflow) =>
        formatDateSafe(workflow.created_at, "MMM d, yyyy", "Unknown date"),
    },
    {
      key: "id",
      label: "Actions",
      className: "text-right",
      render: (workflow) => (
        <div
          className="flex justify-end gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            variant="ghost"
            size="icon"
            disabled={!workflow.is_active}
            onClick={() => onExecute(workflow)}
          >
            <Play className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onEdit(workflow.id)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete({ id: workflow.id, name: workflow.name })}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];
}

export function Workflows() {
  const navigate = useNavigate();
  const deleteWorkflow = useDeleteWorkflow();
  const { activeScopeNodeId } = useScopeContext();
  const [includeDescendants, setIncludeDescendants] = useState(true);
  const isGlobalScope = activeScopeNodeId === GLOBAL_SCOPE_NODE_ID;

  const [deletingWorkflow, setDeletingWorkflow] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [launchingWorkflow, setLaunchingWorkflow] = useState<Workflow | null>(
    null,
  );
  const [workflowNotice, setWorkflowNotice] = useState<{
    type: "success" | "error";
    title: string;
    message: string;
  } | null>(null);

  const fetchWorkflowsPageForActiveScope = useCallback(
    (query: Record<string, unknown>) =>
      fetchWorkflowsPage(query, activeScopeNodeId),
    [activeScopeNodeId],
  );

  const handleDelete = async () => {
    if (!deletingWorkflow) return;

    const workflowName = deletingWorkflow.name;
    try {
      await deleteWorkflow.mutateAsync(deletingWorkflow.id);
      setWorkflowNotice({
        type: "success",
        title: "Workflow removed",
        message: `Workflow "${workflowName}" was deactivated successfully.`,
      });
      setDeletingWorkflow(null);
    } catch (error) {
      setWorkflowNotice({
        type: "error",
        title: "Delete failed",
        message: getApiErrorMessage(error, "Failed to delete workflow."),
      });
    }
  };

  const handleExecute = async (workflow: Workflow) => {
    setWorkflowNotice(null);
    setLaunchingWorkflow(workflow);
  };

  const columns = buildWorkflowColumns({
    onExecute: handleExecute,
    onEdit: (workflowId) => navigate(`/workflows/${workflowId}/edit`),
    onDelete: setDeletingWorkflow,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Workflows</h2>
          <p className="text-muted-foreground">
            Manage and execute your automated workflows
          </p>
        </div>
        <Button onClick={() => navigate("/workflows/new")}>
          <Plus className="mr-2 h-4 w-4" />
          Create Workflow
        </Button>
      </div>

      {!isGlobalScope && (
        <div className="flex items-center gap-2">
          <Checkbox
            id="include-descendants"
            checked={includeDescendants}
            onCheckedChange={(v) => {
              setIncludeDescendants(!!v);
            }}
          />
          <Label htmlFor="include-descendants" className="text-sm">
            Include descendants
          </Label>
        </div>
      )}

      {workflowNotice && <WorkflowNotice notice={workflowNotice} />}

      <DataTable<Workflow>
        mode="server"
        columns={columns}
        filters={[IS_ACTIVE_FILTER]}
        fetchFn={fetchWorkflowsPageForActiveScope}
        queryKey={[
          ...queryKeys.workflows.all(),
          "paginated",
          activeScopeNodeId,
        ]}
        onRowClick={(workflow) => navigate(`/workflows/${workflow.id}`)}
        emptyMessage="No workflows found"
      />

      {launchingWorkflow && (
        <WorkflowLaunchDialog
          open={!!launchingWorkflow}
          onOpenChange={(nextOpen) => {
            if (!nextOpen) {
              setLaunchingWorkflow(null);
            }
          }}
          workflowId={launchingWorkflow.id}
          workflowName={launchingWorkflow.name}
          onLaunched={() => {
            setWorkflowNotice({
              type: "success",
              title: "Execution started",
              message: `Workflow "${launchingWorkflow.name}" launch requested successfully.`,
            });
          }}
        />
      )}

      <AlertDialog
        open={!!deletingWorkflow}
        onOpenChange={() => setDeletingWorkflow(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the workflow &quot;
              {deletingWorkflow?.name}&quot;. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingWorkflow(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteWorkflow.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteWorkflow.isPending ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
