export interface RequestApprovalParams {
  workflowRunId?: string;
  jobId?: string;
  scopeId?: string;
  chatSessionId?: string;
  toolName: string;
  payload: Record<string, unknown>;
  requestedBy: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface ToolCallApprovalResolution {
  status: 'approved' | 'rejected' | 'expired';
  rejectionReason?: string;
  approvedBy?: string;
}
