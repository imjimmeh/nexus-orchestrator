import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatCoreLookupService } from './chat-core-lookup.service';
import type { RequestContextService } from '../common/request-context.service';
import { ChatToCoreActionService } from './chat-to-core-action.service';

describe('ChatToCoreActionService', () => {
  const previousBaseUrl = process.env.CHAT_CORE_BASE_URL;
  const previousToken = process.env.CHAT_CORE_BEARER_TOKEN;
  const previousWorkflow = process.env.CHAT_DEFAULT_WORKFLOW_ID;
  const previousMemoryContextFlag =
    process.env.MEMORY_CONTEXT_INJECTION_ENABLED;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CHAT_CORE_BASE_URL = 'http://core.local:3010/api';
    process.env.CHAT_CORE_BEARER_TOKEN = 'chat-core-token';
    process.env.CHAT_DEFAULT_WORKFLOW_ID = 'workflow-chat-default';
    delete process.env.MEMORY_CONTEXT_INJECTION_ENABLED;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.CHAT_CORE_BASE_URL = previousBaseUrl;
    process.env.CHAT_CORE_BEARER_TOKEN = previousToken;
    process.env.CHAT_DEFAULT_WORKFLOW_ID = previousWorkflow;
    if (typeof previousMemoryContextFlag === 'string') {
      process.env.MEMORY_CONTEXT_INJECTION_ENABLED = previousMemoryContextFlag;
    } else {
      delete process.env.MEMORY_CONTEXT_INJECTION_ENABLED;
    }
  });

  it('requests a core workflow run and returns a persisted run link', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            runId: 'run-1',
            workflowId: 'workflow-chat-default',
            status: 'accepted',
            acceptedAt: '2026-04-13T00:00:00.000Z',
            metadata: {
              correlation_id: 'corr-1',
            },
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    const result = await service.requestAction({
      chatSessionId: 'chat-1',
      messageId: 'msg-1',
      message: 'Please plan the release',
      channel: 'telegram',
      scopeId: 'project-1',
      agentProfileName: 'ceo-agent',
      externalUserId: 'tg-user-1',
      requestedBy: 'telegram_webhook',
      idempotencyKey: 'telegram:1001',
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'http://core.local:3010/api/internal/core/workflow-runs',
    );
    expect(calledInit?.method).toBe('POST');
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer chat-core-token',
      }),
    );
    const parsedPayload: unknown = JSON.parse(
      (calledInit?.body as string | undefined) ?? '{}',
    );
    const payload =
      parsedPayload && typeof parsedPayload === 'object'
        ? (parsedPayload as {
            input?: {
              message?: string;
              objective?: string;
            };
          })
        : {};
    expect(payload.input?.message).toBe('Please plan the release');
    expect(payload.input?.objective).toBe('Please plan the release');

    expect(result).toEqual({
      runId: 'run-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'PENDING',
      correlation_id: 'corr-1',
    });
  });

  it('polls core workflow run status', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            runId: 'run-2',
            workflowId: 'workflow-chat-default',
            status: 'RUNNING',
            updatedAt: '2026-04-13T00:00:30.000Z',
            metadata: {
              correlation_id: 'corr-2',
            },
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    const status = await service.getWorkflowRunStatus('run-2', 'corr-2');

    expect(status.status).toBe('RUNNING');
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'http://core.local:3010/api/internal/core/workflow-runs/run-2',
    );
    expect(calledInit?.method).toBe('GET');
  });

  it('continues an existing workflow run with an injected user message', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            data: { acknowledged: true },
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runId: 'run-continue-1',
            workflowId: 'workflow-chat-default',
            status: 'RUNNING',
            updatedAt: '2026-04-15T10:00:00.000Z',
            metadata: {
              correlation_id: 'corr-continue-1',
            },
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    const result = await service.continueWorkflowRunWithMessage({
      runId: 'run-continue-1',
      message: 'Continue with the same session context',
      correlationId: 'corr-continue-1',
    });

    const [injectUrl, injectInit] = fetchMock.mock.calls[0];
    expect(injectUrl).toBe(
      'http://core.local:3010/api/workflows/runs/run-continue-1/inject',
    );
    expect(injectInit?.method).toBe('POST');
    expect(injectInit?.headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer chat-core-token',
        'x-correlation-id': 'corr-continue-1',
        'content-type': 'application/json',
      }),
    );
    expect(
      JSON.parse((injectInit?.body as string | undefined) ?? '{}'),
    ).toEqual({
      message: 'Continue with the same session context',
    });

    const [statusUrl, statusInit] = fetchMock.mock.calls[1];
    expect(statusUrl).toBe(
      'http://core.local:3010/api/internal/core/workflow-runs/run-continue-1',
    );
    expect(statusInit?.method).toBe('GET');
    expect(result).toEqual({
      runId: 'run-continue-1',
      workflowId: 'workflow-chat-default',
      runStatus: 'RUNNING',
      correlation_id: 'corr-continue-1',
    });
  });

  it('retrieves workflow run details for outbound relay', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: {
              id: 'run-2',
              state_variables: {
                jobs: {
                  delegate: {
                    output: {
                      outputs: {
                        delegated_task: {
                          response: 'assistant output',
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    const runDetails = await service.getWorkflowRunDetails('run-2', 'corr-2');

    expect(runDetails.id).toBe('run-2');
    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe('http://core.local:3010/api/workflows/runs/run-2');
    expect(calledInit?.method).toBe('GET');
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer chat-core-token',
      }),
    );
  });

  it('retrieves workflow run events for pending-question detection', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            data: [
              {
                event_type: 'tool_execution_start',
                timestamp: '2026-04-14T14:23:18.947Z',
                payload: {
                  toolName: 'ask_user_questions',
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    const events = await service.getWorkflowRunEvents('run-evt', 'corr-evt');

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event_type: 'tool_execution_start',
      payload: { toolName: 'ask_user_questions' },
    });

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'http://core.local:3010/api/workflows/runs/run-evt/events',
    );
    expect(calledInit?.method).toBe('GET');
  });

  it('submits workflow run question answers', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ success: true, data: { acknowledged: true } }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    await service.submitWorkflowRunQuestionAnswers('run-q', 'corr-q', [
      {
        questionIndex: 0,
        selectedOption: null,
        freeTextAnswer: 'Proceed with workspace review',
      },
    ]);

    const [calledUrl, calledInit] = fetchMock.mock.calls[0];
    expect(calledUrl).toBe(
      'http://core.local:3010/api/workflows/runs/run-q/question-answers',
    );
    expect(calledInit?.method).toBe('POST');
    expect(calledInit?.headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer chat-core-token',
        'content-type': 'application/json',
      }),
    );

    const parsedBody: unknown = JSON.parse(
      (calledInit?.body as string | undefined) ?? '{}',
    );
    expect(parsedBody).toEqual({
      answers: [
        {
          questionIndex: 0,
          selectedOption: null,
          freeTextAnswer: 'Proceed with workspace review',
        },
      ],
    });
  });

  it('falls back to request correlation id when core response omits metadata', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            runId: 'run-2b',
            workflowId: 'workflow-chat-default',
            status: 'accepted',
            acceptedAt: '2026-04-13T00:00:35.000Z',
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    const result = await service.requestAction({
      chatSessionId: 'chat-2b',
      messageId: 'msg-2b',
      message: 'Plan fallback correlation id',
      channel: 'telegram',
      scopeId: 'project-2b',
      agentProfileName: 'ceo-agent',
    });

    const [, calledInit] = fetchMock.mock.calls[0];
    const parsedPayload: unknown = JSON.parse(
      (calledInit?.body as string | undefined) ?? '{}',
    );
    const payload =
      parsedPayload && typeof parsedPayload === 'object'
        ? (parsedPayload as { metadata?: { correlation_id?: string } })
        : {};

    expect(result.correlation_id).toBe(payload.metadata?.correlation_id);
  });

  it('uses request context correlation and causation when present', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            runId: 'run-2c',
            workflowId: 'workflow-chat-default',
            status: 'accepted',
            acceptedAt: '2026-04-13T00:00:40.000Z',
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal('fetch', fetchMock);

    const requestContext = {
      getRequestId: () => 'corr-from-context',
      getCausationId: () => 'cause-from-context',
    } as unknown as RequestContextService;

    const service = new ChatToCoreActionService(undefined, requestContext);
    await service.requestAction({
      chatSessionId: 'chat-ctx',
      messageId: 'msg-ctx',
      message: 'Use context IDs',
      channel: 'telegram',
      scopeId: 'project-ctx',
      agentProfileName: 'ceo-agent',
    });

    const [, calledInit] = fetchMock.mock.calls[0];
    const parsedPayload: unknown = JSON.parse(
      (calledInit?.body as string | undefined) ?? '{}',
    );
    const payload = parsedPayload as {
      metadata?: {
        correlation_id?: string;
        causation_id?: string;
      };
    };

    expect(payload.metadata?.correlation_id).toBe('corr-from-context');
    expect(payload.metadata?.causation_id).toBe('cause-from-context');
  });

  it('resolves built-in default workflow identifier when env override is missing', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            runId: 'run-3',
            workflowId: '156a767b-fae5-4be3-8ee0-50ff5b512640',
            status: 'accepted',
            acceptedAt: '2026-04-13T00:01:00.000Z',
            metadata: {
              correlation_id: 'corr-3',
            },
          }),
          { status: 200 },
        ),
      );

    const resolveActiveWorkflowId = vi
      .fn()
      .mockResolvedValue('156a767b-fae5-4be3-8ee0-50ff5b512640');
    const coreLookups = {
      resolveActiveWorkflowId,
    } as unknown as ChatCoreLookupService;

    vi.stubGlobal('fetch', fetchMock);
    delete process.env.CHAT_DEFAULT_WORKFLOW_ID;

    const service = new ChatToCoreActionService(coreLookups);
    await service.requestAction({
      chatSessionId: 'chat-3',
      messageId: 'msg-3',
      message: 'Trigger delegated flow',
      channel: 'telegram',
      scopeId: 'project-3',
      agentProfileName: 'ceo-agent',
    });

    expect(resolveActiveWorkflowId).toHaveBeenCalledWith(
      'chat_direct_agent_default',
    );

    const [, calledInit] = fetchMock.mock.calls[0];
    const parsedPayload: unknown = JSON.parse(
      (calledInit?.body as string | undefined) ?? '{}',
    );
    const payload =
      parsedPayload && typeof parsedPayload === 'object'
        ? (parsedPayload as { workflow_id?: string })
        : {};
    expect(payload.workflow_id).toBe('156a767b-fae5-4be3-8ee0-50ff5b512640');
  });

  it('fails fast when symbolic workflow identifier cannot be resolved', async () => {
    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response('{}', { status: 200 }));

    const coreLookups = {
      resolveActiveWorkflowId: vi.fn().mockResolvedValue(null),
    } as unknown as ChatCoreLookupService;

    vi.stubGlobal('fetch', fetchMock);
    process.env.CHAT_DEFAULT_WORKFLOW_ID = 'missing_workflow';

    const service = new ChatToCoreActionService(coreLookups);

    await expect(
      service.requestAction({
        chatSessionId: 'chat-4',
        messageId: 'msg-4',
        message: 'This should fail before fetch',
        channel: 'telegram',
        scopeId: 'project-4',
        agentProfileName: 'ceo-agent',
      }),
    ).rejects.toThrow(/Failed to resolve chat workflow identifier/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards memory_context to the workflow input when injection is enabled', async () => {
    process.env.MEMORY_CONTEXT_INJECTION_ENABLED = 'true';

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            runId: 'run-flag-on',
            workflowId: 'workflow-chat-default',
            status: 'accepted',
            acceptedAt: '2026-04-13T00:02:00.000Z',
            metadata: { correlation_id: 'corr-flag-on' },
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    await service.requestAction({
      chatSessionId: 'chat-flag-on',
      messageId: 'msg-flag-on',
      message: 'inject please',
      channel: 'telegram',
      scopeId: null,
      agentProfileName: 'ceo-agent',
      memoryContext: {
        retrievalId: 'ret-flag',
        hitCount: 1,
        sessionHitCount: 1,
        profileHitCount: 0,
        tokenBudget: 600,
        slices: [
          {
            memoryId: 'mem-1',
            source: 'session',
            memoryType: 'history',
            content: 'remembered',
            score: 0.9,
          },
        ],
      },
    });

    const [, calledInit] = fetchMock.mock.calls[0];
    const parsedPayload: unknown = JSON.parse(
      (calledInit?.body as string | undefined) ?? '{}',
    );
    const payload = parsedPayload as {
      input?: { memory_context?: unknown };
    };
    expect(payload.input?.memory_context).toMatchObject({
      retrievalId: 'ret-flag',
      hitCount: 1,
    });
  });

  it('forces memory_context to null on the workflow input when the flag is disabled', async () => {
    process.env.MEMORY_CONTEXT_INJECTION_ENABLED = 'false';

    const fetchMock = vi
      .fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            runId: 'run-flag-off',
            workflowId: 'workflow-chat-default',
            status: 'accepted',
            acceptedAt: '2026-04-13T00:02:30.000Z',
            metadata: { correlation_id: 'corr-flag-off' },
          }),
          { status: 200 },
        ),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new ChatToCoreActionService();
    await service.requestAction({
      chatSessionId: 'chat-flag-off',
      messageId: 'msg-flag-off',
      message: 'do not inject',
      channel: 'telegram',
      scopeId: null,
      agentProfileName: 'ceo-agent',
      memoryContext: {
        retrievalId: 'ret-flag',
        hitCount: 1,
        sessionHitCount: 1,
        profileHitCount: 0,
        tokenBudget: 600,
        slices: [
          {
            memoryId: 'mem-1',
            source: 'session',
            memoryType: 'history',
            content: 'remembered',
            score: 0.9,
          },
        ],
      },
    });

    const [, calledInit] = fetchMock.mock.calls[0];
    const parsedPayload: unknown = JSON.parse(
      (calledInit?.body as string | undefined) ?? '{}',
    );
    const payload = parsedPayload as {
      input?: { memory_context?: unknown };
    };
    expect(payload.input?.memory_context).toBeNull();
  });
});
