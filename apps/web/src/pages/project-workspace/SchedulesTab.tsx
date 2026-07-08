import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/hooks/useToast";
import { useWorkflows } from "@/hooks/useWorkflows";
import {
  useCreateScheduledJob,
  useDeleteScheduledJob,
  usePauseScheduledJob,
  useResumeScheduledJob,
  useRunScheduledJobNow,
  useScheduledJobRuns,
  useScheduledJobs,
  useUpdateScheduledJob,
} from "@/hooks/useScheduledJobs";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { ScheduledJob } from "@/lib/api/scheduled-jobs.types";
import {
  isScheduledJobType,
  normalizeScheduleTimezone,
  parseSchedulePayloadJson,
  scheduleExpressionPlaceholder,
  toSchedulePayloadText,
} from "./SchedulesTab.helpers";
import { SchedulesTabAutomationHooksCard } from "./SchedulesTabAutomationHooksCard";
import { SchedulesTabEditorCard } from "./SchedulesTabEditorCard";
import { SchedulesTabHeartbeatCard } from "./SchedulesTabHeartbeatCard";
import { SchedulesTabListCard } from "./SchedulesTabListCard";
import { SchedulesTabRunHistory } from "./SchedulesTabRunHistory";
import { SchedulesTabStandingOrdersCard } from "./SchedulesTabStandingOrdersCard";
import type {
  ScheduleListCallbacks,
  ScheduleEditorState,
  SchedulesListActionState,
  SchedulesStatusFilter,
} from "./SchedulesTab.types";

interface SchedulesTabProps {
  readonly projectId: string;
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

async function togglePauseResumeAction(params: {
  job: ScheduledJob;
  pauseSchedule: { mutateAsync: (jobId: string) => Promise<unknown> };
  resumeSchedule: { mutateAsync: (jobId: string) => Promise<unknown> };
  toast: ReturnType<typeof useToast>;
}): Promise<void> {
  try {
    if (params.job.status === "active") {
      await params.pauseSchedule.mutateAsync(params.job.id);
      params.toast.info(
        "Schedule paused",
        "The schedule will not trigger until resumed.",
      );
    } else {
      await params.resumeSchedule.mutateAsync(params.job.id);
      params.toast.success("Schedule resumed", "The schedule is active again.");
    }
  } catch (error) {
    params.toast.error(
      "Schedule action failed",
      getApiErrorMessage(error, "Unable to change schedule status."),
    );
  }
}

async function runNowAction(params: {
  jobId: string;
  runNowSchedule: { mutateAsync: (jobId: string) => Promise<unknown> };
  setSelectedRunsJobId: (jobId: string) => void;
  toast: ReturnType<typeof useToast>;
}): Promise<void> {
  try {
    await params.runNowSchedule.mutateAsync(params.jobId);
    params.toast.success(
      "Run queued",
      "The schedule was triggered immediately.",
    );
    params.setSelectedRunsJobId(params.jobId);
  } catch (error) {
    params.toast.error(
      "Run now failed",
      getApiErrorMessage(error, "Unable to trigger this schedule."),
    );
  }
}

async function deleteScheduleAction(params: {
  jobId: string;
  deleteSchedule: { mutateAsync: (jobId: string) => Promise<unknown> };
  selectedRunsJobId: string | null;
  editingJobId: string | null;
  setSelectedRunsJobId: (jobId: string | null) => void;
  resetEditor: () => void;
  toast: ReturnType<typeof useToast>;
}): Promise<void> {
  try {
    await params.deleteSchedule.mutateAsync(params.jobId);
    params.toast.info("Schedule deleted", "The schedule has been removed.");
    if (params.selectedRunsJobId === params.jobId) {
      params.setSelectedRunsJobId(null);
    }
    if (params.editingJobId === params.jobId) {
      params.resetEditor();
    }
  } catch (error) {
    params.toast.error(
      "Delete failed",
      getApiErrorMessage(error, "Unable to delete schedule."),
    );
  }
}

function buildActionState(params: {
  pausePending: boolean;
  resumePending: boolean;
  runNowPending: boolean;
  deletePending: boolean;
}): SchedulesListActionState {
  return {
    pausePending: params.pausePending,
    resumePending: params.resumePending,
    runNowPending: params.runNowPending,
    deletePending: params.deletePending,
  };
}

function buildListCallbacks(params: {
  startEdit: (job: ScheduledJob) => void;
  pauseSchedule: { mutateAsync: (jobId: string) => Promise<unknown> };
  resumeSchedule: { mutateAsync: (jobId: string) => Promise<unknown> };
  runNowSchedule: { mutateAsync: (jobId: string) => Promise<unknown> };
  deleteSchedule: { mutateAsync: (jobId: string) => Promise<unknown> };
  selectedRunsJobId: string | null;
  editingJobId: string | null;
  setSelectedRunsJobId: (jobId: string | null) => void;
  resetEditor: () => void;
  toast: ReturnType<typeof useToast>;
}): ScheduleListCallbacks {
  return {
    onEdit: params.startEdit,
    onTogglePauseResume: (job) => {
      void togglePauseResumeAction({
        job,
        pauseSchedule: params.pauseSchedule,
        resumeSchedule: params.resumeSchedule,
        toast: params.toast,
      });
    },
    onRunNow: (jobId) => {
      void runNowAction({
        jobId,
        runNowSchedule: params.runNowSchedule,
        setSelectedRunsJobId: (nextJobId) =>
          params.setSelectedRunsJobId(nextJobId),
        toast: params.toast,
      });
    },
    onDelete: (jobId) => {
      void deleteScheduleAction({
        jobId,
        deleteSchedule: params.deleteSchedule,
        selectedRunsJobId: params.selectedRunsJobId,
        editingJobId: params.editingJobId,
        setSelectedRunsJobId: params.setSelectedRunsJobId,
        resetEditor: params.resetEditor,
        toast: params.toast,
      });
    },
    onToggleRuns: (jobId) => {
      params.setSelectedRunsJobId(
        params.selectedRunsJobId === jobId ? null : jobId,
      );
    },
  };
}

export function SchedulesTab({ projectId }: Readonly<SchedulesTabProps>) {
  const toast = useToast();
  const [statusFilter, setStatusFilter] =
    useState<SchedulesStatusFilter>("all");
  const [selectedRunsJobId, setSelectedRunsJobId] = useState<string | null>(
    null,
  );
  const [editingJobId, setEditingJobId] = useState<string | null>(null);

  const { data: workflows = [] } = useWorkflows();
  const activeWorkflows = useMemo(
    () => workflows.filter((workflow) => workflow.is_active),
    [workflows],
  );
  const workflowOptions = useMemo(
    () =>
      activeWorkflows.map((workflow) => ({
        id: workflow.id,
        name: workflow.name,
      })),
    [activeWorkflows],
  );

  const scheduleQuery = useScheduledJobs({
    projectId,
    scope: "scope",
    status: statusFilter === "all" ? undefined : statusFilter,
  });
  const runsQuery = useScheduledJobRuns(selectedRunsJobId ?? undefined);

  const createSchedule = useCreateScheduledJob(projectId);
  const updateSchedule = useUpdateScheduledJob();
  const pauseSchedule = usePauseScheduledJob();
  const resumeSchedule = useResumeScheduledJob();
  const runNowSchedule = useRunScheduledJobNow();
  const deleteSchedule = useDeleteScheduledJob();

  const [editor, setEditor] = useState<ScheduleEditorState>(() =>
    createEditorState(""),
  );

  useEffect(() => {
    if (editor.workflow_id || activeWorkflows.length === 0) {
      return;
    }

    setEditor((current) => ({
      ...current,
      workflow_id: activeWorkflows[0]?.id ?? "",
    }));
  }, [activeWorkflows, editor.workflow_id]);

  const isSubmitting = createSchedule.isPending || updateSchedule.isPending;

  const handleEditorChange = (
    key: keyof ScheduleEditorState,
    value: string,
  ) => {
    setEditor((current) => ({
      ...current,
      [key]: value,
    }));
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
    setEditingJobId(null);
    setEditor(createEditorState(activeWorkflows[0]?.id ?? ""));
  };

  const startEdit = (job: ScheduledJob) => {
    setEditingJobId(job.id);
    setEditor({
      name: job.name,
      schedule_type: job.schedule_type,
      schedule_expression: job.schedule_expression,
      timezone: job.timezone ?? "UTC",
      workflow_id: job.execution_target_ref,
      payload_text: toSchedulePayloadText(job.payload_json),
    });
  };

  const handleSubmit = async () => {
    if (!editor.workflow_id || !editor.name.trim()) {
      toast.error("Missing required fields", "Name and workflow are required.");
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

    const payload = {
      name: editor.name.trim(),
      schedule_type: editor.schedule_type,
      schedule_expression: editor.schedule_expression.trim(),
      timezone: normalizeScheduleTimezone(
        editor.timezone,
        editor.schedule_type,
      ),
      workflow_id: editor.workflow_id,
      payload_json: payloadJson,
    };

    try {
      if (editingJobId) {
        await updateSchedule.mutateAsync({
          id: editingJobId,
          data: payload,
        });
        toast.success("Schedule updated", "Schedule configuration was saved.");
      } else {
        await createSchedule.mutateAsync(payload);
        toast.success("Schedule created", "New automation schedule is active.");
      }

      resetEditor();
    } catch (error) {
      toast.error(
        "Failed to save schedule",
        getApiErrorMessage(error, "Unable to persist schedule changes."),
      );
    }
  };

  const actionState = buildActionState({
    pausePending: pauseSchedule.isPending,
    resumePending: resumeSchedule.isPending,
    runNowPending: runNowSchedule.isPending,
    deletePending: deleteSchedule.isPending,
  });
  const callbacks = buildListCallbacks({
    startEdit,
    pauseSchedule,
    resumeSchedule,
    runNowSchedule,
    deleteSchedule,
    selectedRunsJobId,
    editingJobId,
    setSelectedRunsJobId,
    resetEditor,
    toast,
  });

  return (
    <div className="space-y-4">
      <SchedulesTabEditorCard
        editingJobId={editingJobId}
        activeWorkflows={workflowOptions}
        editor={editor}
        isSubmitting={isSubmitting}
        onEditorChange={handleEditorChange}
        onScheduleTypeChange={handleScheduleTypeChange}
        onSubmit={() => {
          void handleSubmit();
        }}
        onCancelEdit={resetEditor}
      />

      <SchedulesTabListCard
        jobs={scheduleQuery.data?.items ?? []}
        isLoading={scheduleQuery.isLoading}
        statusFilter={statusFilter}
        selectedRunsJobId={selectedRunsJobId}
        actionState={actionState}
        onStatusFilterChange={setStatusFilter}
        callbacks={callbacks}
      />

      <SchedulesTabRunHistory
        selectedRunsJobId={selectedRunsJobId}
        isLoading={runsQuery.isLoading}
        runs={runsQuery.data}
      />

      <SchedulesTabAutomationHooksCard
        projectId={projectId}
        workflows={workflowOptions}
      />

      <SchedulesTabHeartbeatCard
        projectId={projectId}
        workflows={workflowOptions}
      />

      <SchedulesTabStandingOrdersCard projectId={projectId} />
    </div>
  );
}
