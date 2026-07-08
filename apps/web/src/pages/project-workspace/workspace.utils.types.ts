import { WorkItemLiveState } from "@/lib/api/work-items.types";

export interface SessionSummary {
  status: WorkItemLiveState;
  hasExecution: boolean;
  label: string;
}
