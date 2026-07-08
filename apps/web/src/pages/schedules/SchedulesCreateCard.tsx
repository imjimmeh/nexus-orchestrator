import { Label } from "@/components/ui/label";
import { ScheduledJobScope } from "@/lib/api/scheduled-jobs.types";
import { SchedulesTabEditorCard } from "../project-workspace/SchedulesTabEditorCard";
import type { ScheduleEditorState } from "../project-workspace/SchedulesTab.types";

interface SchedulesCreateCardProps {
  editor: ScheduleEditorState;
  workflowOptions: Array<{ id: string; name: string }>;
  isSubmitting: boolean;
  createScope: ScheduledJobScope;
  onCreateScopeChange: (scope: ScheduledJobScope) => void;
  createProjectId: string;
  onCreateProjectIdChange: (projectId: string) => void;
  projects: Array<{ id: string; name: string }>;
  onEditorChange: (key: keyof ScheduleEditorState, value: string) => void;
  onScheduleTypeChange: (value: string) => void;
  onCreate: () => void;
  onCancelEdit: () => void;
}

export function SchedulesCreateCard({
  editor,
  workflowOptions,
  isSubmitting,
  createScope,
  onCreateScopeChange,
  createProjectId,
  onCreateProjectIdChange,
  projects,
  onEditorChange,
  onScheduleTypeChange,
  onCreate,
  onCancelEdit,
}: Readonly<SchedulesCreateCardProps>) {
  return (
    <SchedulesTabEditorCard
      editingJobId={null}
      activeWorkflows={workflowOptions}
      editor={editor}
      isSubmitting={isSubmitting}
      extraFields={
        <>
          <div className="space-y-2">
            <Label htmlFor="create-schedule-scope">Schedule Scope</Label>
            <select
              id="create-schedule-scope"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createScope}
              onChange={(event) => {
                onCreateScopeChange(event.target.value as ScheduledJobScope);
              }}
            >
              <option value="global">Global</option>
              <option value="scope">Project</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="create-schedule-project">Project</Label>
            <select
              id="create-schedule-project"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={createProjectId}
              onChange={(event) => {
                onCreateProjectIdChange(event.target.value);
              }}
              disabled={createScope !== "scope"}
            >
              <option value="">Select project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>
        </>
      }
      onEditorChange={onEditorChange}
      onScheduleTypeChange={onScheduleTypeChange}
      onSubmit={onCreate}
      onCancelEdit={onCancelEdit}
    />
  );
}
