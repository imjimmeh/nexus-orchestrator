export type SubagentCapabilityContext = {
  agentProfileName: string;
  allowedTools: string[];
  parentJobId?: string;
  requestedJobId?: string;
  subagentExecutionId: string;
  workflowRunId: string;
};
