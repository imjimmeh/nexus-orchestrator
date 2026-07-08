import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventLedgerService } from '../../observability/event-ledger.service';
import { SpecialStepAuditPublisher } from './special-step-audit.publisher';

describe('SpecialStepAuditPublisher', () => {
  let emitBestEffort: ReturnType<typeof vi.fn>;
  let publisher: SpecialStepAuditPublisher;

  beforeEach(() => {
    emitBestEffort = vi.fn().mockResolvedValue(undefined);
    const eventLedger = {
      emitBestEffort,
    } as unknown as EventLedgerService;
    publisher = new SpecialStepAuditPublisher(eventLedger);
  });

  it('records a success audit event with a workflow.special_step.<type>.succeeded event name', async () => {
    await publisher.audit({
      type: 'http_webhook',
      outcome: 'succeeded',
      workflowRunId: 'run-1',
      stepId: 'notify',
      payload: { method: 'POST', url: 'https://example.test/hook' },
    });

    expect(emitBestEffort).toHaveBeenCalledWith({
      domain: 'workflow',
      eventName: 'workflow.special_step.http_webhook.succeeded',
      outcome: 'success',
      payload: {
        workflow_run_id: 'run-1',
        step_id: 'notify',
        method: 'POST',
        url: 'https://example.test/hook',
      },
    });
  });

  it('records a failure audit event with the error message', async () => {
    await publisher.audit({
      type: 'mcp_tool_call',
      outcome: 'failed',
      workflowRunId: 'run-2',
      stepId: 'call_external',
      payload: {
        server_id: 'external-mcp',
        tool_name: 'external.resource_update',
      },
      errorMessage: 'connection refused',
    });

    expect(emitBestEffort).toHaveBeenCalledWith({
      domain: 'workflow',
      eventName: 'workflow.special_step.mcp_tool_call.failed',
      outcome: 'failure',
      payload: {
        workflow_run_id: 'run-2',
        step_id: 'call_external',
        server_id: 'external-mcp',
        tool_name: 'external.resource_update',
      },
      errorMessage: 'connection refused',
    });
  });

  it('maps blocked outcomes to a failure ledger outcome', async () => {
    await publisher.audit({
      type: 'http_webhook',
      outcome: 'blocked',
      workflowRunId: 'run-3',
      stepId: 'notify',
      payload: { method: 'GET', url: 'https://evil.test/hook' },
      errorMessage:
        "Step notify: http_webhook URL 'https://evil.test/hook' is not allowed by policy",
    });

    expect(emitBestEffort).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'workflow.special_step.http_webhook.blocked',
        outcome: 'failure',
      }),
    );
  });

  it('omits errorMessage when not provided', async () => {
    await publisher.audit({
      type: 'http_webhook',
      outcome: 'succeeded',
      workflowRunId: 'run-4',
      stepId: 'notify',
      payload: { method: 'POST', url: 'https://example.test/hook' },
    });

    expect(emitBestEffort).toHaveBeenCalledWith({
      domain: 'workflow',
      eventName: 'workflow.special_step.http_webhook.succeeded',
      outcome: 'success',
      payload: {
        workflow_run_id: 'run-4',
        step_id: 'notify',
        method: 'POST',
        url: 'https://example.test/hook',
      },
    });
    expect(
      (emitBestEffort.mock.calls[0]?.[0] as { errorMessage?: string })
        .errorMessage,
    ).toBeUndefined();
  });
});
