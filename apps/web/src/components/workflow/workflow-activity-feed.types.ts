import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

type ActivityCategory = "workflow" | "tool";

export type ActivityQuickType =
  | "all"
  | "step"
  | "tool"
  | "question"
  | "error"
  | "completion"
  | "system";

export type WorkflowActivityFeedFilters = {
  searchQuery: string;
  showWorkflowEvents: boolean;
  showToolEvents: boolean;
  showFailuresOnly: boolean;
  quickType: ActivityQuickType;
};

export type ActivityItem = {
  key: string;
  event: WorkflowTelemetryEvent;
  category: ActivityCategory;
  summary: string | null;
  toolName: string | null;
  stepId: string | null;
  jobId: string | null;
  isFailureLike: boolean;
  isRateLimitRetry: boolean;
  quickType: ActivityQuickType;
  searchText: string;
};
