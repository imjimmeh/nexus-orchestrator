import { ScheduledJob } from "@/lib/api/scheduled-jobs.types";

export interface ScheduleEditorState {
  name: string;
  schedule_type: ScheduledJob["schedule_type"];
  schedule_expression: string;
  timezone: string;
  workflow_id: string;
  payload_text: string;
}

export interface ScheduleWorkflowOption {
  id: string;
  name: string;
}

export type SchedulesStatusFilter = "all" | ScheduledJob["status"];

export interface SchedulesListActionState {
  pausePending: boolean;
  resumePending: boolean;
  runNowPending: boolean;
  deletePending: boolean;
}

export interface ScheduleListCallbacks {
  onEdit: (job: ScheduledJob) => void;
  onTogglePauseResume: (job: ScheduledJob) => void;
  onRunNow: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onToggleRuns: (jobId: string) => void;
}
