import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as http from 'node:http';
import {
  ContainerHttpClientService,
  resolveAgentPostTimeoutMs,
  resolveHealthCheckTimeoutMs,
  DEFAULT_AGENT_POST_TIMEOUT_MS,
  DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
  AGENT_ASYNC_ACCEPT_TIMEOUT_MS,
} from './container-http-client.service';

describe('ContainerHttpClientService', () => {
  let service: ContainerHttpClientService;
  let mockServer: http.Server;
  let serverPort: number;
  let baseUrl: string;

  beforeEach(async () => {
    service = new ContainerHttpClientService();

    // Create a real HTTP server for integration-style tests
    mockServer = http.createServer();
    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        const addr = mockServer.address() as { port: number };
        serverPort = addr.port;
        baseUrl = `http://127.0.0.1:${serverPort}`;
        resolve();
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      mockServer.close(() => {
        resolve();
      });
    });
  });

  it('buildBaseUrl formats container IP with port', () => {
    expect(service.buildBaseUrl('172.17.0.5')).toBe('http://172.17.0.5:8374');
  });

  it('waitForHealth resolves when /health returns 200', async () => {
    mockServer.on('request', (req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      }
    });

    await expect(
      service.waitForHealth(baseUrl, 5_000),
    ).resolves.toBeUndefined();
  });

  it('waitForHealth times out when server never responds 200', async () => {
    mockServer.on('request', (_req, res) => {
      res.writeHead(503);
      res.end();
    });

    await expect(service.waitForHealth(baseUrl, 1_500)).rejects.toThrow(
      'Container health check timed out',
    );
  });

  it('fails fast when the container has exited before becoming healthy', async () => {
    mockServer.on('request', (_req, res) => {
      res.writeHead(503);
      res.end();
    });
    const isContainerRunning = vi.fn().mockResolvedValue(false);

    const start = Date.now();
    await expect(
      service.waitForHealth(baseUrl, 30_000, {
        containerId: 'c-1',
        fetchLogs: async () => 'boot log',
        isContainerRunning,
      }),
    ).rejects.toThrow(/exited before becoming healthy/);

    // Must bail on the liveness probe, not wait out the 30s ceiling.
    expect(Date.now() - start).toBeLessThan(5_000);
    expect(isContainerRunning).toHaveBeenCalled();
  });

  it('strips NUL bytes from embedded container log diagnostics so the health error is DB-safe', async () => {
    mockServer.on('request', (_req, res) => {
      res.writeHead(503);
      res.end();
    });
    const NUL = String.fromCharCode(0);
    const isContainerRunning = vi.fn().mockResolvedValue(false);

    const error = await service
      .waitForHealth(baseUrl, 30_000, {
        containerId: 'c-1',
        fetchLogs: async () => `health probe failed${NUL}${NUL}npm warn`,
        isContainerRunning,
      })
      .catch((e: unknown) => e as Error);

    // A raw Docker log tail carries NUL bytes from the multiplex frame headers;
    // embedding them unsanitized lets the message wedge any downstream jsonb
    // write (the run_command result an agent later persists via set_job_output).
    expect(error.message.includes(NUL)).toBe(false);
    expect(error.message).toContain('npm warn');
  });

  it('keeps waiting while the container is still running, then times out', async () => {
    mockServer.on('request', (_req, res) => {
      res.writeHead(503);
      res.end();
    });
    const isContainerRunning = vi.fn().mockResolvedValue(true);

    await expect(
      service.waitForHealth(baseUrl, 1_500, {
        containerId: 'c-1',
        fetchLogs: async () => 'log',
        isContainerRunning,
      }),
    ).rejects.toThrow(/health check timed out/);
    expect(isContainerRunning).toHaveBeenCalled();
  });

  describe('resolveHealthCheckTimeoutMs', () => {
    it('defaults to a provisioning-aware ceiling when env is unset', () => {
      expect(resolveHealthCheckTimeoutMs(undefined)).toBe(
        DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      );
      // The baked image may run `npm install` on lockfile drift before the
      // health server starts; 60s is too tight for a monorepo install.
      expect(DEFAULT_HEALTH_CHECK_TIMEOUT_MS).toBeGreaterThanOrEqual(300_000);
    });

    it('uses a valid positive integer from env', () => {
      expect(resolveHealthCheckTimeoutMs('120000')).toBe(120_000);
    });

    it('falls back to the default for non-numeric or non-positive values', () => {
      expect(resolveHealthCheckTimeoutMs('abc')).toBe(
        DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      );
      expect(resolveHealthCheckTimeoutMs('0')).toBe(
        DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      );
      expect(resolveHealthCheckTimeoutMs('-5')).toBe(
        DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      );
    });
  });

  it('executeAgent posts to /execute/agent and returns response', async () => {
    mockServer.on('request', (req, res) => {
      if (req.url === '/execute/agent' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              response: `Executed: ${body.stepId}`,
            }),
          );
        });
      }
    });

    const result = await service.executeAgent(baseUrl, {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-test',
      auth: { type: 'api_key', apiKey: 'sk-test' },
      systemPrompt: 'test',
      stepId: 'step-1',
    });

    expect(result).toEqual({
      ok: true,
      response: 'Executed: step-1',
    });
  });

  it('executeCommand posts to /execute/command and returns response', async () => {
    mockServer.on('request', (req, res) => {
      if (req.url === '/execute/command' && req.method === 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            ok: true,
            exit_code: 0,
            stdout: ' M file.ts',
            stderr: '',
            timed_out: false,
          }),
        );
      }
    });

    const result = await service.executeCommand(baseUrl, {
      command: 'git status --porcelain',
    });

    expect(result).toEqual({
      ok: true,
      exit_code: 0,
      stdout: ' M file.ts',
      stderr: '',
      timed_out: false,
    });
  });

  it('shutdown posts to /shutdown and does not throw', async () => {
    mockServer.on('request', (req, res) => {
      if (req.url === '/shutdown') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'shutting_down' }));
      }
    });

    await expect(service.shutdown(baseUrl)).resolves.toBeUndefined();
  });

  it('shutdown does not throw when container is unavailable', async () => {
    // Close the server first
    await new Promise<void>((resolve) => {
      mockServer.close(() => {
        resolve();
      });
    });

    // Use a dummy to prevent afterEach from double-closing
    mockServer = http.createServer();
    await new Promise<void>((resolve) => {
      mockServer.listen(0, '127.0.0.1', () => {
        resolve();
      });
    });

    await expect(
      service.shutdown('http://127.0.0.1:19999'),
    ).resolves.toBeUndefined();
  });

  describe('resolveAgentPostTimeoutMs', () => {
    it('defaults to 6 hours when env is unset', () => {
      expect(resolveAgentPostTimeoutMs(undefined)).toBe(
        DEFAULT_AGENT_POST_TIMEOUT_MS,
      );
      expect(DEFAULT_AGENT_POST_TIMEOUT_MS).toBe(6 * 60 * 60 * 1000);
    });

    it('uses a valid positive integer from env', () => {
      expect(resolveAgentPostTimeoutMs('5400000')).toBe(5_400_000);
    });

    it('falls back to the default for non-numeric or non-positive values', () => {
      expect(resolveAgentPostTimeoutMs('abc')).toBe(
        DEFAULT_AGENT_POST_TIMEOUT_MS,
      );
      expect(resolveAgentPostTimeoutMs('0')).toBe(
        DEFAULT_AGENT_POST_TIMEOUT_MS,
      );
      expect(resolveAgentPostTimeoutMs('-1')).toBe(
        DEFAULT_AGENT_POST_TIMEOUT_MS,
      );
    });
  });

  it('executeAgentAsync posts mode:async to /execute/agent and returns 202 body', async () => {
    let receivedBody: Record<string, unknown> = {};

    mockServer.on('request', (req, res) => {
      if (req.url === '/execute/agent' && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          receivedBody = JSON.parse(Buffer.concat(chunks).toString()) as Record<
            string,
            unknown
          >;
          res.writeHead(202, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, accepted: true }));
        });
      }
    });

    const result = await service.executeAgentAsync(baseUrl, {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKey: 'sk-test',
      auth: { type: 'api_key', apiKey: 'sk-test' },
      systemPrompt: 'test',
      stepId: 'step-async-1',
    });

    expect(result).toEqual({ ok: true, accepted: true });
    expect(receivedBody['mode']).toBe('async');
    expect(AGENT_ASYNC_ACCEPT_TIMEOUT_MS).toBe(60_000);
  });

  it('executeAgent throws on HTTP 400 errors', async () => {
    mockServer.on('request', (req, res) => {
      if (req.url === '/execute/agent') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields' }));
      }
    });

    await expect(
      service.executeAgent(baseUrl, {
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        apiKey: 'sk-test',
        auth: { type: 'api_key', apiKey: 'sk-test' },
        systemPrompt: 'test',
        stepId: 'step-1',
      }),
    ).rejects.toThrow('HTTP 400');
  });
});
