export type SubagentExecutionStatus =
  | "spawning"
  | "running"
  | "completed"
  | "failed"
  | "unknown";

export interface WorkflowSubagentExecutionSummary {
  id: string;
  status: SubagentExecutionStatus;
  lastEventName: string;
  lastEventAt: string;
  childContainerId: string | null;
  subagentChatSessionId?: string | null;
}
