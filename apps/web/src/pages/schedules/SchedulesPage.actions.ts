import type { Dispatch, SetStateAction } from "react";
import type {
  useCreateScheduledJob,
  useDeleteScheduledJob,
  usePauseScheduledJob,
  useResumeScheduledJob,
  useRunScheduledJobNow,
} from "@/hooks/useScheduledJobs";
import type { useToast } from "@/hooks/useToast";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { ScheduledJob, ScheduledJobScope } from "@/lib/api/scheduled-jobs.types";
import {
  isScheduledJobType,
  normalizeScheduleTimezone,
  parseSchedulePayloadJson,
  scheduleExpressionPlaceholder,
} from "../project-workspace/SchedulesTab.helpers";
import type { ScheduleEditorState } from "../project-workspace/SchedulesTab.types";

interface ScheduleActionParams {
  editor: ScheduleEditorState;
  createScope: ScheduledJobScope;
  createProjectId: string;
  activeWorkflowId: string;
  defaultProjectId: string;
  setEditor: Dispatch<SetStateAction<ScheduleEditorState>>;
  setCreateScope: Dispatch<SetStateAction<ScheduledJobScope>>;
  setCreateProjectId: Dispatch<SetStateAction<string>>;
  createSchedule: ReturnType<typeof useCreateScheduledJob>;
  pauseSchedule: ReturnType<typeof usePauseScheduledJob>;
  resumeSchedule: ReturnType<typeof useResumeScheduledJob>;
  runNowSchedule: ReturnType<typeof useRunScheduledJobNow>;
  deleteSchedule: ReturnType<typeof useDeleteScheduledJob>;
  toast: ReturnType<typeof useToast>;
}

function createEditorState(workflowId: string): ScheduleEditorState {
  return {
    name: "",
    schedule_type: "cron",
    schedule_expression: "*/15 * * * *",
    timezone: "UTC",
    workflow_id: workflowId,
    payload_text: "",
  };
}

function createMutationActions(params: ScheduleActionParams) {
  const {
    editor,
    createScope,
    createProjectId,
    createSchedule,
    pauseSchedule,
    resumeSchedule,
    runNowSchedule,
    deleteSchedule,
    toast,
  } = params;

  const handleCreate = async (resetEditor: () => void) => {
    if (!editor.workflow_id || !editor.name.trim()) {
      toast.error("Missing required fields", "Name and workflow are required.");
      return;
    }
    if (createScope === "scope" && !createProjectId) {
      toast.error(
        "Missing project",
        "Select a project when creating a project-scoped schedule.",
      );
      return;
    }

    const payloadJson: Record<string, unknown> | undefined = (() => {
      try {
        return parseSchedulePayloadJson(editor.payload_text);
      } catch (error) {
        toast.error(
          "Invalid payload JSON",
          getApiErrorMessage(error, "Payload JSON must be a valid object."),
        );
        return undefined;
      }
    })();

    if (editor.payload_text.trim().length > 0 && payloadJson === undefined) {
      return;
    }

    try {
      await createSchedule.mutateAsync({
        schedule_scope: createScope,
        scopeId: createScope === "scope" ? createProjectId : undefined,
        name: editor.name.trim(),
        schedule_type: editor.schedule_type,
        schedule_expression: editor.schedule_expression.trim(),
        timezone: normalizeScheduleTimezone(
          editor.timezone,
          editor.schedule_type,
        ),
        workflow_id: editor.workflow_id,
        payload_json: payloadJson,
      });
      toast.success("Schedule created", "New automation schedule is active.");
      resetEditor();
    } catch (error) {
      toast.error(
        "Failed to create schedule",
        getApiErrorMessage(error, "Unable to persist the new schedule."),
      );
    }
  };

  const handlePauseResume = async (job: ScheduledJob) => {
    try {
      if (job.status === "active") {
        await pauseSchedule.mutateAsync(job.id);
        toast.info("Schedule paused", "The schedule is now paused.");
        return;
      }
      await resumeSchedule.mutateAsync(job.id);
      toast.success("Schedule resumed", "The schedule is active again.");
    } catch (error) {
      toast.error(
        "Schedule action failed",
        getApiErrorMessage(error, "Unable to update schedule state."),
      );
    }
  };

  const handleRunNow = async (jobId: string) => {
    try {
      await runNowSchedule.mutateAsync(jobId);
      toast.success("Run queued", "Schedule run has been triggered.");
    } catch (error) {
      toast.error(
        "Run now failed",
        getApiErrorMessage(error, "Unable to run this schedule."),
      );
    }
  };

  const handleDelete = async (jobId: string) => {
    try {
      await deleteSchedule.mutateAsync(jobId);
      toast.info("Schedule deleted", "The schedule has been removed.");
    } catch (error) {
      toast.error(
        "Delete failed",
        getApiErrorMessage(error, "Unable to delete this schedule."),
      );
    }
  };

  return { handleCreate, handlePauseResume, handleRunNow, handleDelete };
}

export function useScheduleActions(params: ScheduleActionParams) {
  const {
    activeWorkflowId,
    defaultProjectId,
    setEditor,
    setCreateScope,
    setCreateProjectId,
  } = params;

  const handleEditorChange = (
    key: keyof ScheduleEditorState,
    value: string,
  ) => {
    setEditor((current) => ({ ...current, [key]: value }));
  };

  const handleScheduleTypeChange = (value: string) => {
    if (!isScheduledJobType(value)) {
      return;
    }
    setEditor((current) => ({
      ...current,
      schedule_type: value,
      schedule_expression: scheduleExpressionPlaceholder(value),
    }));
  };

  const resetEditor = () => {
    setEditor(createEditorState(activeWorkflowId));
    setCreateScope("global");
    setCreateProjectId(defaultProjectId);
  };

  const {
    handleCreate: doCreate,
    handlePauseResume,
    handleRunNow,
    handleDelete,
  } = createMutationActions(params);

  const handleCreate = async () => {
    await doCreate(resetEditor);
  };

  return {
    handleEditorChange,
    handleScheduleTypeChange,
    handleCreate,
    resetEditor,
    handlePauseResume,
    handleRunNow,
    handleDelete,
  };
}
