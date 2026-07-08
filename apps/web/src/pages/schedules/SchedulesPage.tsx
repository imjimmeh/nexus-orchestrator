import { SchedulesCreateCard } from "./SchedulesCreateCard";
import { SchedulesFilterCard } from "./SchedulesFilterCard";
import { ScheduledJobList } from "./ScheduledJobList";
import { useSchedulesPageController } from "./SchedulesPage.controller";

// Not wired to the active app scope (Phase 5 Task 8): the "scope" on this
// page (ScheduledJobScope = "global" | "scope", filtered by projectId) is a
// pre-existing Kanban-project-vs-global axis on `scheduled_jobs.scope_id`,
// unrelated to the multi-tenant scope_node hierarchy ScopeContext manages.
// ScheduledJobsController's list endpoint was not part of the Task 7
// default-deny checklist and has no scopeNodeId param.
export function SchedulesPage() {
  const controller = useSchedulesPageController();

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Schedules</h2>
        <p className="text-muted-foreground">
          Unified schedule management across global and project scopes.
        </p>
      </div>

      <SchedulesCreateCard
        editor={controller.editor}
        workflowOptions={controller.workflowOptions}
        isSubmitting={controller.createSchedule.isPending}
        createScope={controller.createScope}
        onCreateScopeChange={controller.setCreateScope}
        createProjectId={controller.createProjectId}
        onCreateProjectIdChange={controller.setCreateProjectId}
        projects={controller.projectQuery.data ?? []}
        onEditorChange={controller.handleEditorChange}
        onScheduleTypeChange={controller.handleScheduleTypeChange}
        onCreate={() => {
          void controller.handleCreate();
        }}
        onCancelEdit={controller.resetEditor}
      />

      <SchedulesFilterCard
        scopeFilter={controller.scopeFilter}
        onScopeFilterChange={controller.setScopeFilter}
        statusFilter={controller.statusFilter}
        onStatusFilterChange={controller.setStatusFilter}
        projectFilter={controller.projectFilter}
        onProjectFilterChange={controller.setProjectFilter}
        projects={controller.projectQuery.data ?? []}
      />

      <ScheduledJobList
        isLoading={controller.schedulesQuery.isLoading}
        jobs={controller.schedulesQuery.data?.items ?? []}
        projectNamesById={controller.projectNamesById}
        onPauseResume={(job) => {
          void controller.handlePauseResume(job);
        }}
        onRunNow={(jobId) => {
          void controller.handleRunNow(jobId);
        }}
        onDelete={(jobId) => {
          void controller.handleDelete(jobId);
        }}
      />
    </div>
  );
}
