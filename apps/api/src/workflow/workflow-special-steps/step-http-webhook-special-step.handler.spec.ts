import { describe, expect, it, vi } from 'vitest';
import type { SpecialStepAuditPublisher } from './special-step-audit.publisher';
import { StepHttpWebhookSpecialStepHandler } from './step-http-webhook-special-step.handler';

function createHandler(fetchImpl: typeof fetch = vi.fn()) {
  const auditPublisher = {
    audit: vi.fn().mockResolvedValue(undefined),
  } as unknown as SpecialStepAuditPublisher;

  return {
    auditPublisher,
    handler: new StepHttpWebhookSpecialStepHandler(auditPublisher, fetchImpl),
  };
}

describe('StepHttpWebhookSpecialStepHandler', () => {
  it('rejects webhook calls without an explicit URL allowlist policy', async () => {
    const { handler } = createHandler();

    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'notify',
        step: { id: 'notify', type: 'http_webhook', tier: 'light' },
        resolvedStepInputs: {
          url: 'https://external.internal/projects/p1/resources/w1/status',
        },
      }),
    ).rejects.toThrow(
      'Step notify: http_webhook requires inputs.policy.allowed_urls',
    );
  });

  it('blocks URLs that are not allowed by policy and audits the denial', async () => {
    const { handler, auditPublisher } = createHandler();

    await expect(
      handler.execute({
        workflowRunId: 'run-1',
        stepId: 'notify',
        step: { id: 'notify', type: 'http_webhook', tier: 'light' },
        resolvedStepInputs: {
          url: 'https://evil.example/hook',
          policy: { allowed_urls: ['https://external.internal/*'] },
        },
      }),
    ).rejects.toThrow(
      "Step notify: http_webhook URL 'https://evil.example/hook' is not allowed by policy",
    );
    expect(auditPublisher.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'http_webhook',
        outcome: 'blocked',
        workflowRunId: 'run-1',
        stepId: 'notify',
        payload: {
          method: 'POST',
          url: 'https://evil.example/hook',
        },
        errorMessage:
          "Step notify: http_webhook URL 'https://evil.example/hook' is not allowed by policy",
      }),
    );
  });

  it('posts JSON to an allowed URL and audits success', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      headers: new Headers({ 'content-type': 'application/json' }),
      text: vi.fn().mockResolvedValue('{"accepted":true}'),
    }) as unknown as typeof fetch;
    const { handler, auditPublisher } = createHandler(fetchImpl);

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'notify',
      step: { id: 'notify', type: 'http_webhook', tier: 'light' },
      resolvedStepInputs: {
        url: 'https://external.internal/projects/p1/resources/w1/status',
        method: 'PATCH',
        body: { status: 'done' },
        policy: {
          allowed_urls: ['https://external.internal/projects/*'],
          allowed_methods: ['PATCH'],
        },
      },
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://external.internal/projects/p1/resources/w1/status',
      expect.objectContaining({ method: 'PATCH' }),
    );
    expect(result.result).toEqual({
      status: 'completed',
      mode: 'http_webhook',
      method: 'PATCH',
      statusCode: 202,
    });
    expect(result.output).toMatchObject({ ok: true, status_code: 202 });
    expect(result.output.response_json).toEqual({ accepted: true });
    expect(auditPublisher.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'http_webhook',
        outcome: 'succeeded',
        workflowRunId: 'run-1',
        stepId: 'notify',
        payload: {
          method: 'PATCH',
          url: 'https://external.internal/projects/p1/resources/w1/status',
        },
      }),
    );
  });

  it('returns an auditable failed output when the HTTP request fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('connection refused'));
    const { handler, auditPublisher } = createHandler(fetchImpl);

    const result = await handler.execute({
      workflowRunId: 'run-1',
      stepId: 'notify',
      step: { id: 'notify', type: 'http_webhook', tier: 'light' },
      resolvedStepInputs: {
        url: 'https://external.internal/hook',
        policy: { allowed_urls: ['https://external.internal/*'] },
      },
    });

    expect(result.output).toMatchObject({
      ok: false,
      error: 'connection refused',
      timed_out: false,
    });
    expect(auditPublisher.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'http_webhook',
        outcome: 'failed',
        workflowRunId: 'run-1',
        stepId: 'notify',
        payload: {
          method: 'POST',
          url: 'https://external.internal/hook',
        },
        errorMessage: 'connection refused',
      }),
    );
  });
});
