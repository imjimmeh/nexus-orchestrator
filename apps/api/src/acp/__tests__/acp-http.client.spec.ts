import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AcpHttpClient,
  AcpHttpClientConfig,
  AcpAuthType,
} from '../acp-http.client';
import { AcpRunStatus } from '@nexus/core';
import type { AcpAgentManifest, AcpRun, AcpSession } from '@nexus/core';

describe('AcpHttpClient', () => {
  const createClient = (
    config: Partial<AcpHttpClientConfig> = {},
  ): AcpHttpClient => {
    return new AcpHttpClient({
      baseUrl: 'http://localhost:3000',
      authType: AcpAuthType.NONE,
      timeoutMs: 5000,
      connectTimeoutMs: 3000,
      ...config,
    });
  };

  const mockFetch = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('ping', () => {
    it('succeeds when server returns 204', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

      const client = createClient();
      await expect(client.ping()).resolves.toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/ping',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws when server returns error status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
        json: async () => ({ error: 'Internal Server Error' }),
      });

      const client = createClient();
      await expect(client.ping()).rejects.toThrow('status 500');
    });

    it('throws on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const client = createClient();
      await expect(client.ping()).rejects.toThrow('Network failure');
    });
  });

  describe('listAgents', () => {
    it('returns agents list without pagination', async () => {
      const agents: AcpAgentManifest[] = [
        { name: 'agent-1', description: 'First agent' },
        { name: 'agent-2', description: 'Second agent' },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ agents }),
      });

      const client = createClient();
      const result = await client.listAgents();

      expect(result.agents).toEqual(agents);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/agents',
        expect.any(Object),
      );
    });

    it('returns agents list with pagination params', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ agents: [], total: 0 }),
      });

      const client = createClient();
      await client.listAgents(10, 20);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/agents?limit=10&offset=20',
        expect.any(Object),
      );
    });

    it('returns empty result when response has no body', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => '',
      });

      const client = createClient();
      const result = await client.listAgents();

      expect(result).toEqual({});
    });
  });

  describe('getAgent', () => {
    it('returns agent manifest for valid name', async () => {
      const agent: AcpAgentManifest = {
        name: 'my-agent',
        description: 'My agent description',
        input_content_types: ['application/json'],
        output_content_types: ['application/json'],
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(agent),
      });

      const client = createClient();
      const result = await client.getAgent('my-agent');

      expect(result).toEqual(agent);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/agents/my-agent',
        expect.any(Object),
      );
    });

    it('encodes special characters in agent name', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ name: 'test/agent' }),
      });

      const client = createClient();
      await client.getAgent('test/agent');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/agents/test%2Fagent',
        expect.any(Object),
      );
    });
  });

  describe('createRun', () => {
    it('creates a run and returns run object', async () => {
      const run: AcpRun = {
        run_id: 'run-123',
        status: AcpRunStatus.CREATED,
        created_at: '2026-04-15T00:00:00Z',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        text: async () => JSON.stringify(run),
      });

      const client = createClient();
      const result = await client.createRun({
        agent_name: 'test-agent',
        message: {
          role: 'user',
          content_type: 'application/json',
          content: '{}',
        },
      });

      expect(result).toEqual(run);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/runs',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            agent_name: 'test-agent',
            message: {
              role: 'user',
              content_type: 'application/json',
              content: '{}',
            },
          }),
        }),
      );
    });
  });

  describe('getRun', () => {
    it('returns run by id', async () => {
      const run: AcpRun = {
        run_id: 'run-123',
        status: AcpRunStatus.IN_PROGRESS,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(run),
      });

      const client = createClient();
      const result = await client.getRun('run-123');

      expect(result).toEqual(run);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/runs/run-123',
        expect.any(Object),
      );
    });
  });

  describe('resumeRun', () => {
    it('resumes a run with message', async () => {
      const run: AcpRun = {
        run_id: 'run-123',
        status: AcpRunStatus.COMPLETED,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(run),
      });

      const client = createClient();
      const result = await client.resumeRun('run-123', {
        message: {
          role: 'user',
          content_type: 'text/plain',
          content: 'continue',
        },
      });

      expect(result).toEqual(run);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/runs/run-123',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            message: {
              role: 'user',
              content_type: 'text/plain',
              content: 'continue',
            },
          }),
        }),
      );
    });
  });

  describe('cancelRun', () => {
    it('cancels a run', async () => {
      const run: AcpRun = {
        run_id: 'run-123',
        status: AcpRunStatus.CANCELLED,
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(run),
      });

      const client = createClient();
      const result = await client.cancelRun('run-123');

      expect(result).toEqual(run);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/runs/run-123/cancel',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  describe('authentication', () => {
    it('injects Bearer token for BEARER auth type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

      const client = createClient({
        authType: AcpAuthType.BEARER,
        authToken: 'my-secret-token',
      });
      await client.ping();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/ping',
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer my-secret-token',
          }),
        }),
      );
    });

    it('injects API key for API_KEY auth type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

      const client = createClient({
        authType: AcpAuthType.API_KEY,
        authToken: 'my-api-key',
      });
      await client.ping();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/ping',
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-api-key': 'my-api-key',
          }),
        }),
      );
    });

    it('does not inject auth header for NONE auth type', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

      const client = createClient({
        authType: AcpAuthType.NONE,
      });
      await client.ping();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/ping',
        expect.objectContaining({
          headers: expect.not.objectContaining(['authorization', 'x-api-key']),
        }),
      );
    });

    it('merges custom headers with auth headers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

      const client = createClient({
        authType: AcpAuthType.BEARER,
        authToken: 'token',
        headers: { 'X-Custom-Header': 'custom-value' },
      });
      await client.ping();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/ping',
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'Bearer token',
            'X-Custom-Header': 'custom-value',
          }),
        }),
      );
    });
  });

  describe('timeout handling', () => {
    it('respects custom timeout from options', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      });

      const client = createClient({ timeoutMs: 10000 });
      await client.listAgents(undefined, undefined);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('times out on slow response', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      mockFetch.mockRejectedValue(abortError);

      const client = createClient({ timeoutMs: 50 });

      await expect(client.ping()).rejects.toThrow();
    });
  });

  describe('getSession', () => {
    it('returns session by id', async () => {
      const session: AcpSession = {
        session_id: 'session-123',
        created_at: '2026-04-15T00:00:00Z',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(session),
      });

      const client = createClient();
      const result = await client.getSession('session-123');

      expect(result).toEqual(session);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/session/session-123',
        expect.any(Object),
      );
    });
  });

  describe('listRunEvents', () => {
    it('returns events for a run', async () => {
      const events = [
        { type: 'message' as const, data: { content: 'hello' } },
        { type: 'RunState' as const, data: { status: 'completed' } },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(events),
      });

      const client = createClient();
      const result = await client.listRunEvents('run-123');

      expect(result).toEqual(events);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/runs/run-123/events',
        expect.any(Object),
      );
    });
  });
});
