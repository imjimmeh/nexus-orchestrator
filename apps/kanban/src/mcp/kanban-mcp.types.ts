export interface KanbanMcpCallContext {
  correlationId?: string | null;
  workflowRunId?: string | null;
  jobId?: string | null;
  stepId?: string | null;
  scopeId?: string | null;
}

export interface KanbanMcpAuditEntry {
  eventName: "kanban.mcp.tool.succeeded" | "kanban.mcp.tool.failed";
  toolName: string;
  correlationId: string | null;
  workflowRunId: string | null;
  errorMessage?: string;
}
