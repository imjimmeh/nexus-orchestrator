export const AGENT_AWAIT_STATUS_VALUES = [
  "WAITING",
  "RESUMING",
  "RESUMED",
  "CANCELLED",
] as const;
export type AgentAwaitStatus = (typeof AGENT_AWAIT_STATUS_VALUES)[number];

export const WAIT_REASON_VALUES = ["human_input", "dependency"] as const;
export type WaitReason = (typeof WAIT_REASON_VALUES)[number];

export interface SatisfiedChild {
  runId: string;
  status: "COMPLETED" | "FAILED" | "CANCELLED";
}

export type HarnessSessionRef =
  | { kind: "pi"; treeId: string; resumeNodeId?: string }
  | { kind: "claude_code"; sessionId: string };
