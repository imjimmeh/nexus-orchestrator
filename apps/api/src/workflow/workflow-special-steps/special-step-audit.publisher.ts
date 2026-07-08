import { Injectable } from '@nestjs/common';
import { EventLedgerService } from '../../observability/event-ledger.service';
import type { SpecialStepAuditParams } from './special-step-audit.publisher.types';

/**
 * Records `workflow.special_step.<type>.<outcome>` audit events through the
 * event ledger. Replaces the per-handler `audit()` wrappers that
 * `http_webhook` and `mcp_tool_call` previously kept inline.
 *
 * Outcome mapping: 'succeeded' → 'success'; 'failed' and 'blocked' → 'failure'.
 * `errorMessage` is included in the event only when provided.
 */
@Injectable()
export class SpecialStepAuditPublisher {
  constructor(private readonly eventLedger: EventLedgerService) {}

  audit(params: SpecialStepAuditParams): Promise<void> {
    const { type, outcome, workflowRunId, stepId, payload, errorMessage } =
      params;
    return this.eventLedger.emitBestEffort({
      domain: 'workflow',
      eventName: `workflow.special_step.${type}.${outcome}`,
      outcome: outcome === 'succeeded' ? 'success' : 'failure',
      payload: {
        workflow_run_id: workflowRunId,
        step_id: stepId,
        ...payload,
      },
      ...(errorMessage ? { errorMessage } : {}),
    });
  }
}
