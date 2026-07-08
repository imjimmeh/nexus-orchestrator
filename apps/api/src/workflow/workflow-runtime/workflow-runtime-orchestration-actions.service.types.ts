export type InvokeAgentWorkflowParams = Record<string, unknown>;

export interface MutatingActionResult {
  ok: boolean;
  requestedAction: string;
  modeEvaluation: 'allow' | 'deny' | 'require_approval';
  executionStatus:
    | 'executed'
    | 'queued_for_approval'
    | 'denied'
    | 'failed'
    | 'skipped_due_concurrency'
    | 'skipped_circuit_open'
    | 'invalid_workflow';
  correlationId: string;
  actionRequest?: { id: string };
  runId?: string | null;
  alreadyActive?: boolean;
  agentProfileActual?: string | null;
  createdProfileId?: string | null;
  createdProfileName?: string | null;
  recommendation?: string;
  authoritySource?: string;
  error?: string;
  errorCode?: string;
  errorMessage?: string;
  requestedWorkflowId?: string;
}
