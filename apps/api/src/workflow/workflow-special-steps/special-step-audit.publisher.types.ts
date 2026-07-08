export type SpecialStepAuditOutcome = 'succeeded' | 'failed' | 'blocked';

export interface SpecialStepAuditParams {
  /** Step type string used to build the audit event name, e.g. 'http_webhook'. */
  type: string;
  outcome: SpecialStepAuditOutcome;
  workflowRunId: string;
  stepId: string;
  /**
   * Type-specific payload fields merged into the audit event payload. The
   * standard `workflow_run_id` and `step_id` keys are added by the publisher.
   */
  payload: Record<string, unknown>;
  errorMessage?: string;
}
