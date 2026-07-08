import { ProjectStateSnapshot } from "@/lib/api/projects.types";

interface ProjectStatsPanelProps {
  projectState: ProjectStateSnapshot;
}

export function ProjectStatsPanel({
  projectState,
}: Readonly<ProjectStatsPanelProps>) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">Total Work Items</p>
        <p className="text-lg font-semibold">{projectState.totalCount}</p>
      </div>
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">Active</p>
        <p className="text-lg font-semibold">{projectState.activeCount}</p>
      </div>
      <div className="rounded-md border p-3">
        <p className="text-xs text-muted-foreground">Blocked</p>
        <p className="text-lg font-semibold">
          {projectState.groupedByStatus.blocked?.length ?? 0}
        </p>
      </div>
    </div>
  );
}
