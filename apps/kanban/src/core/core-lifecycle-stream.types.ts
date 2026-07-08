export type TerminalWorkflowStatus = "COMPLETED" | "FAILED" | "CANCELLED";
export type TerminalWorkItemRunKind =
  | "completed_work_item"
  | "failed_work_item"
  | "other";
