export type {
  CreateWorkItemInput,
  DispatchWorkItemInput,
  MergeWorkItemInput,
  ReviewDecisionInput,
  WorkItemRecord,
  WorkItemRunRequestResult,
  WorkItemStatus,
} from "@nexus/kanban-contracts";

export interface LifecycleGateFailure {
  workflowName: string;
  status: string;
  error: string | null;
  runId: string | null;
}

export interface LifecycleGateMarker {
  targetStatus: string;
  hook: "before";
  status: "held";
  heldAt: string;
  failures: LifecycleGateFailure[];
}
