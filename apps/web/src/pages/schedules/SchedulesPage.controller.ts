import { useEffect, useMemo, useState } from "react";
import { useProjectList } from "@/hooks/useProjects";
import { useWorkflows } from "@/hooks/useWorkflows";
import {
  useCreateScheduledJob,
  useDeleteScheduledJob,
  usePauseScheduledJob,
  useResumeScheduledJob,
  useRunScheduledJobNow,
  useScheduledJobs,
} from "@/hooks/useScheduledJobs";
import { useToast } from "@/hooks/useToast";
import { ScheduledJob, ScheduledJobScope } from "@/lib/api/scheduled-jobs.types";
import type { ScheduleEditorState } from "../project-workspace/SchedulesTab.types";
import { useScheduleActions } from "./SchedulesPage.actions";

type ScopeFilter = "all" | ScheduledJobScope;
type StatusFilter = "all" | ScheduledJob["status"];

export function useSchedulesPageController() {
  const toast = useToast();
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [createScope, setCreateScope] = useState<ScheduledJobScope>("global");
  const [createProjectId, setCreateProjectId] = useState<string>("");
  const [editor, setEditor] = useState<ScheduleEditorState>(() => ({
    name: "",
    schedule_type: "cron",
    schedule_expression: "*/15 * * * *",
    timezone: "UTC",
    workflow_id: "",
    payload_text: "",
  }));

  const projectQuery = useProjectList();
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
  const projectNamesById = useMemo(
    () =>
      new Map(
        (projectQuery.data ?? []).map((project) => [project.id, project.name]),
      ),
    [projectQuery.data],
  );

  const schedulesQuery = useScheduledJobs({
    scope: scopeFilter === "all" ? undefined : scopeFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
    projectId: projectFilter === "all" ? undefined : projectFilter,
  });

  const createSchedule = useCreateScheduledJob();
  const pauseSchedule = usePauseScheduledJob();
  const resumeSchedule = useResumeScheduledJob();
  const runNowSchedule = useRunScheduledJobNow();
  const deleteSchedule = useDeleteScheduledJob();

  useEffect(() => {
    if (editor.workflow_id || activeWorkflows.length === 0) {
      return;
    }

    setEditor((current) => ({
      ...current,
      workflow_id: activeWorkflows[0]?.id ?? "",
    }));
  }, [activeWorkflows, editor.workflow_id]);

  useEffect(() => {
    if (
      createScope !== "scope" ||
      createProjectId ||
      !projectQuery.data?.length
    ) {
      return;
    }

    setCreateProjectId(projectQuery.data[0]?.id ?? "");
  }, [createProjectId, createScope, projectQuery.data]);

  const {
    handleEditorChange,
    handleScheduleTypeChange,
    handleCreate,
    resetEditor,
    handlePauseResume,
    handleRunNow,
    handleDelete,
  } = useScheduleActions({
    editor,
    createScope,
    createProjectId,
    activeWorkflowId: activeWorkflows[0]?.id ?? "",
    defaultProjectId: projectQuery.data?.[0]?.id ?? "",
    setEditor,
    setCreateScope,
    setCreateProjectId,
    createSchedule,
    pauseSchedule,
    resumeSchedule,
    runNowSchedule,
    deleteSchedule,
    toast,
  });

  return {
    scopeFilter,
    setScopeFilter,
    statusFilter,
    setStatusFilter,
    projectFilter,
    setProjectFilter,
    createScope,
    setCreateScope,
    createProjectId,
    setCreateProjectId,
    editor,
    projectQuery,
    workflowOptions,
    projectNamesById,
    schedulesQuery,
    createSchedule,
    handleEditorChange,
    handleScheduleTypeChange,
    handleCreate,
    resetEditor,
    handlePauseResume,
    handleRunNow,
    handleDelete,
  };
}
