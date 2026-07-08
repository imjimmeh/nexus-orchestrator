export interface AgentUserContext {
  userId?: string;
  roles?: string[];
  agentProfileName?: string;
  workflowRunId?: string;
  stepId?: string;
  jobId?: string;
  isSubagent?: boolean;
  subagentExecutionId?: string;
  parentJobId?: string;
  allowedTools?: string[];
}

export interface AgentExecutionContext {
  workflowRunId: string;
  jobId: string;
}
