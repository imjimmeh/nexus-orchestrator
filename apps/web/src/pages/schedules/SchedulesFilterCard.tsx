import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { ScheduledJob, ScheduledJobScope } from "@/lib/api/scheduled-jobs.types";

type ScopeFilter = "all" | ScheduledJobScope;
type StatusFilter = "all" | ScheduledJob["status"];

interface SchedulesFilterCardProps {
  scopeFilter: ScopeFilter;
  onScopeFilterChange: (scopeFilter: ScopeFilter) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (statusFilter: StatusFilter) => void;
  projectFilter: string;
  onProjectFilterChange: (projectFilter: string) => void;
  projects: Array<{ id: string; name: string }>;
}

export function SchedulesFilterCard({
  scopeFilter,
  onScopeFilterChange,
  statusFilter,
  onStatusFilterChange,
  projectFilter,
  onProjectFilterChange,
  projects,
}: Readonly<SchedulesFilterCardProps>) {
  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Schedule Filters</CardTitle>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="schedule-scope-filter">Scope</Label>
            <select
              id="schedule-scope-filter"
              className="flex h-9 min-w-40 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={scopeFilter}
              onChange={(event) => {
                onScopeFilterChange(event.target.value as ScopeFilter);
              }}
            >
              <option value="all">All</option>
              <option value="global">Global</option>
              <option value="scope">Project</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="schedule-status-filter">Status</Label>
            <select
              id="schedule-status-filter"
              className="flex h-9 min-w-40 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={statusFilter}
              onChange={(event) => {
                onStatusFilterChange(event.target.value as StatusFilter);
              }}
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="paused">Paused</option>
            </select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="schedule-project-filter">Project</Label>
            <select
              id="schedule-project-filter"
              className="flex h-9 min-w-56 rounded-md border border-input bg-background px-3 py-1 text-sm"
              value={projectFilter}
              onChange={(event) => {
                onProjectFilterChange(event.target.value);
              }}
            >
              <option value="all">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}
