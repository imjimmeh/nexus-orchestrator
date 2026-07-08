import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkflowRuns } from "@/hooks/useWorkflows";
import { api } from "@/lib/api/client";
import { workflowFilesClient } from "@/lib/api/client.workflow-files";
import { GateSettingsCard } from "./GateSettingsCard";
import { RecentRunsCard } from "./RecentRunsCard";
import type { WorkflowFileItem } from "@/lib/api/client.workflow-files.types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FilePlus, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { KANBAN_COLUMNS } from "@/pages/kanban/kanban.utils";
import { WorkItemStatus } from "@/lib/api/work-items.types";
import { CreateWorkflowFileDialog } from "./CreateWorkflowFileDialog";
import { DeleteWorkflowFileDialog } from "./DeleteWorkflowFileDialog";

interface RepositoryWorkflowsTabProps {
  readonly projectId: string;
  readonly repositoryRootPath?: string | null;
}

interface RepositoryFilesCardProps {
  readonly error: string | null;
  readonly files: WorkflowFileItem[];
  readonly loading: boolean;
  readonly onCreate: () => void;
  readonly onDelete: (filename: string) => void;
  readonly onEdit: (filename: string) => void;
  readonly onRefresh: () => void;
}

function filenameFromPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1];
}

interface ColumnGroup {
  status: WorkItemStatus;
  title: string;
  files: WorkflowFileItem[];
}

interface OtherGroup {
  files: WorkflowFileItem[];
}

export function buildColumnGroups(files: WorkflowFileItem[]): {
  columnGroups: ColumnGroup[];
  otherFiles: WorkflowFileItem[];
} {
  const byPhase = new Map<string, WorkflowFileItem[]>();
  const otherFiles: WorkflowFileItem[] = [];

  for (const file of files) {
    const trigger = file.trigger;
    if (trigger) {
      const existing = byPhase.get(trigger.phase) ?? [];
      existing.push(file);
      byPhase.set(trigger.phase, existing);
    } else {
      otherFiles.push(file);
    }
  }

  const columnGroups: ColumnGroup[] = KANBAN_COLUMNS.map((column) => ({
    status: column.status,
    title: column.title,
    files: byPhase.get(column.status) ?? [],
  }));

  // Files whose trigger.phase doesn't match any known column go to otherFiles
  for (const [phase, phaseFiles] of byPhase.entries()) {
    if (!KANBAN_COLUMNS.some((col) => col.status === phase)) {
      otherFiles.push(...phaseFiles);
    }
  }

  return { columnGroups, otherFiles };
}

function WorkflowFileRow({
  file,
  onDelete,
  onEdit,
}: {
  readonly file: WorkflowFileItem;
  readonly onDelete: (filename: string) => void;
  readonly onEdit: (filename: string) => void;
}) {
  const filename = filenameFromPath(file.path);
  const trigger = file.trigger;

  return (
    <TableRow key={file.path}>
      <TableCell className="font-mono text-sm">{filename}</TableCell>
      <TableCell>
        {trigger ? (
          <Badge variant={trigger.blocking ? "destructive" : "secondary"}>
            {trigger.blocking ? "blocking" : "react"}
          </Badge>
        ) : null}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" onClick={() => onEdit(filename)}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onDelete(filename)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

function ColumnGroupSection({
  group,
  onDelete,
  onEdit,
}: {
  readonly group: ColumnGroup;
  readonly onDelete: (filename: string) => void;
  readonly onEdit: (filename: string) => void;
}) {
  return (
    <section aria-labelledby={`column-group-${group.status}`} className="mb-6">
      <h3
        id={`column-group-${group.status}`}
        className="mb-2 text-sm font-semibold text-foreground"
      >
        {group.title}
      </h3>
      {group.files.length === 0 ? (
        <p className="text-xs text-muted-foreground pl-1">
          No gates configured
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-24 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.files.map((file) => (
              <WorkflowFileRow
                key={file.path}
                file={file}
                onDelete={onDelete}
                onEdit={onEdit}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function OtherGroupSection({
  otherGroup,
  onDelete,
  onEdit,
}: {
  readonly otherGroup: OtherGroup;
  readonly onDelete: (filename: string) => void;
  readonly onEdit: (filename: string) => void;
}) {
  if (otherGroup.files.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="column-group-other" className="mb-6">
      <h3
        id="column-group-other"
        className="mb-2 text-sm font-semibold text-foreground"
      >
        Other
      </h3>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File</TableHead>
            <TableHead className="w-24">Type</TableHead>
            <TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {otherGroup.files.map((file) => (
            <WorkflowFileRow
              key={file.path}
              file={file}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

function RepositoryFilesGroupedView({
  files,
  loading,
  onDelete,
  onEdit,
}: Pick<
  RepositoryFilesCardProps,
  "files" | "loading" | "onDelete" | "onEdit"
>) {
  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading...</p>;
  }

  if (files.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-8">
        No workflow files found in .nexus/workflows/
      </p>
    );
  }

  const { columnGroups, otherFiles } = buildColumnGroups(files);

  return (
    <div>
      {columnGroups.map((group) => (
        <ColumnGroupSection
          key={group.status}
          group={group}
          onDelete={onDelete}
          onEdit={onEdit}
        />
      ))}
      <OtherGroupSection
        otherGroup={{ files: otherFiles }}
        onDelete={onDelete}
        onEdit={onEdit}
      />
    </div>
  );
}

function RepositoryFilesCard({
  error,
  files,
  loading,
  onCreate,
  onDelete,
  onEdit,
  onRefresh,
}: RepositoryFilesCardProps) {
  if (error) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-muted-foreground">{error}</p>
          <Button variant="outline" className="mt-4" onClick={onRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Repository Workflows</CardTitle>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button size="sm" onClick={onCreate}>
            <FilePlus className="mr-2 h-4 w-4" /> New Workflow
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <RepositoryFilesGroupedView
          files={files}
          loading={loading}
          onDelete={onDelete}
          onEdit={onEdit}
        />
      </CardContent>
    </Card>
  );
}

export function RepositoryWorkflowsTab({
  projectId,
  repositoryRootPath = null,
}: RepositoryWorkflowsTabProps) {
  const navigate = useNavigate();
  const [files, setFiles] = useState<WorkflowFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [refreshingDiscovery, setRefreshingDiscovery] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const repositoryRuns = useWorkflowRuns({
    projectId,
    sourceType: "repository",
    refetchIntervalMs: 10000,
  });

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await workflowFilesClient.list(projectId);
      if (result.error) {
        setError(result.error);
      } else {
        setFiles(result.files);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load files");
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await workflowFilesClient.remove(projectId, deleteTarget);
      setDeleteTarget(null);
      await loadFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleRefreshDiscovery = async () => {
    const rootPath = repositoryRootPath?.trim();
    if (!rootPath) {
      return;
    }

    setRefreshingDiscovery(true);
    setDiscoveryError(null);
    try {
      await api.refreshRepositoryWorkflows({ scopeId: projectId, rootPath });
      await loadFiles();
      await repositoryRuns.refetch?.();
    } catch (err) {
      setDiscoveryError(
        err instanceof Error ? err.message : "Failed to refresh discovery",
      );
    } finally {
      setRefreshingDiscovery(false);
    }
  };

  const handleEdit = (filename: string) => {
    navigate(
      `/projects/${projectId}/workflow-files/${encodeURIComponent(filename)}/edit`,
    );
  };

  return (
    <div className="space-y-4">
      <GateSettingsCard projectId={projectId} />

      <RepositoryFilesCard
        error={error}
        files={files}
        loading={loading}
        onCreate={() => setCreateOpen(true)}
        onDelete={setDeleteTarget}
        onEdit={handleEdit}
        onRefresh={() => void loadFiles()}
      />

      <RecentRunsCard
        discoveryError={discoveryError}
        isLoading={repositoryRuns.isLoading}
        onRefreshDiscovery={() => void handleRefreshDiscovery()}
        onRunClick={(run) =>
          navigate(`/workflows/${run.workflow_id}/runs/${run.id}`)
        }
        refreshingDiscovery={refreshingDiscovery}
        repositoryRootPath={repositoryRootPath}
        runs={repositoryRuns.data ?? []}
      />

      <CreateWorkflowFileDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projectId={projectId}
        onCreated={loadFiles}
      />

      <DeleteWorkflowFileDialog
        open={!!deleteTarget}
        filename={deleteTarget ?? ""}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
}
