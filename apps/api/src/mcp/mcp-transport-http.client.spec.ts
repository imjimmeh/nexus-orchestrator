import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpServerStatus, McpTransportType } from '@nexus/core';
import type { McpServer } from './database/entities/mcp-server.entity';
import type { SecretReferenceResolver } from '../security/secret-reference-resolver.service';
import { McpHttpTransportClient } from './mcp-transport-http.client';

const server: McpServer = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'External MCP',
  enabled: true,
  transport_type: McpTransportType.HTTP,
  command: null,
  args: null,
  url: 'http://external.local/mcp',
  headers: { authorization: 'Bearer service-token' },
  headers_secret_id: null,
  include_tools: null,
  exclude_tools: null,
  timeout_ms: 30000,
  connect_timeout_ms: 10000,
  max_retries: 1,
  retry_backoff_ms: 1,
  last_status: McpServerStatus.UNKNOWN,
  last_error: null,
  last_connected_at: null,
  last_discovered_at: null,
  last_discovered_tool_count: null,
  created_at: new Date('2026-05-22T00:00:00.000Z'),
  updated_at: new Date('2026-05-22T00:00:00.000Z'),
};

const buildResolver = (): SecretReferenceResolver => {
  const resolveMap = vi.fn(
    async (params: {
      secretId: string | null | undefined;
      plaintext: Record<string, string> | null | undefined;
      purpose: string;
      serverName: string;
    }) => params.plaintext ?? null,
  );
  return {
    resolveString: vi.fn(),
    resolveMap,
    assertSecretExists: vi.fn().mockResolvedValue(undefined),
    redactServer: vi.fn((value) => value),
  } as unknown as SecretReferenceResolver;
};

describe('McpHttpTransportClient', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: () =>
        Promise.resolve(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            result: { content: [{ type: 'text', text: 'ok' }] },
          }),
        ),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('forwards runtime context headers on MCP tool calls', async () => {
    const resolver = buildResolver();
    const client = new McpHttpTransportClient(resolver);

    await client.callTool(
      server,
      'external.scope_state',
      { scope_id: 'scope-1' },
      {
        workflowRunId: 'run-1',
        jobId: 'job-1',
        stepId: 'step-1',
      },
    );

    const toolCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(toolCall[0]).toBe('http://external.local/mcp');
    expect(toolCall[1].headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer service-token',
        'content-type': 'application/json',
        'x-workflow-run-id': 'run-1',
        'x-job-id': 'job-1',
        'x-step-id': 'step-1',
      }),
    );
  });

  it('forwards the scope as the x-scope-id header so scope-aware servers can infer scope', async () => {
    const resolver = buildResolver();
    const client = new McpHttpTransportClient(resolver);

    await client.callTool(
      server,
      'external.scope_state',
      {},
      {
        workflowRunId: 'run-1',
        jobId: 'job-1',
        stepId: 'step-1',
        scopeId: 'scope-1',
      },
    );

    const toolCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(toolCall[1].headers).toEqual(
      expect.objectContaining({
        'x-scope-id': 'scope-1',
      }),
    );
  });

  it('resolves headers from a secret reference when set', async () => {
    const resolver = buildResolver();
    resolver.resolveMap = vi.fn(async () => ({
      authorization: 'Bearer secret-token',
    }));
    const client = new McpHttpTransportClient(resolver);

    await client.callTool(
      { ...server, headers_secret_id: '99999999-9999-4999-8999-999999999999' },
      'external.scope_state',
      {},
    );

    const toolCall = fetchMock.mock.calls.at(-1) as [string, RequestInit];
    expect(toolCall[1].headers).toEqual(
      expect.objectContaining({
        authorization: 'Bearer secret-token',
        'content-type': 'application/json',
      }),
    );
  });
});
