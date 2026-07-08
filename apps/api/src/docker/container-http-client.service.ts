import { Injectable, Logger } from '@nestjs/common';
import * as http from 'node:http';
import type {
  ContainerAgentRequest,
  ContainerAgentResponse,
  ContainerCommandRequest,
  ContainerCommandResponse,
  HealthCheckDiagnostics,
} from './container-http-client.service.types';
import { sanitizeJsonSafeLogText } from './container-log-text.utils';

export type {
  ContainerAgentRequest,
  ContainerAgentResponse,
  ContainerCommandRequest,
  ContainerCommandResponse,
} from './container-http-client.service.types';

const CONTAINER_SERVER_PORT = 8374;
const HEALTH_CHECK_INTERVAL_MS = 500;

/**
 * Upper bound on how long to wait for a freshly-started container's `/health`
 * endpoint. The baked heavy image re-provisions `/workspace/node_modules` from
 * the mounted repo's lockfile at startup (running `npm install` on drift, which
 * for this monorepo can take minutes) BEFORE the health server begins listening.
 * A 60s ceiling falsely reaped healthy-but-still-installing containers as
 * `container_lost`; the liveness probe in {@link ContainerHttpClientService.waitForHealth}
 * keeps genuinely-dead containers from squatting this larger window.
 * Override with `CONTAINER_HEALTH_CHECK_TIMEOUT_MS`.
 */
export const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 300_000; // 5 minutes

export const DEFAULT_AGENT_POST_TIMEOUT_MS = 6 * 60 * 60 * 1000; // 6 hours
export const AGENT_ASYNC_ACCEPT_TIMEOUT_MS = 60_000; // 60 seconds — just waiting for acceptance, not execution

/**
 * Resolves the container health-check timeout from a raw env value, falling back
 * to {@link DEFAULT_HEALTH_CHECK_TIMEOUT_MS} for absent/invalid/non-positive input.
 */
export function resolveHealthCheckTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
  }
  return parsed;
}

export function resolveAgentPostTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_AGENT_POST_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_AGENT_POST_TIMEOUT_MS;
  }
  return parsed;
}

@Injectable()
export class ContainerHttpClientService {
  private readonly logger = new Logger(ContainerHttpClientService.name);

  buildBaseUrl(containerIp: string): string {
    return `http://${containerIp}:${CONTAINER_SERVER_PORT}`;
  }

  async waitForHealth(
    baseUrl: string,
    timeoutMs = DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
    diagnostics?: HealthCheckDiagnostics,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      try {
        const response = await this.httpGet(`${baseUrl}/health`);
        if (response.statusCode === 200) {
          this.logger.log(`Container healthy at ${baseUrl}`);
          return;
        }
      } catch {
        // Connection refused — server not ready yet
      }

      // A container that has already exited will never become healthy. Fail
      // fast with a clear, retryable signal rather than squatting the full
      // provisioning-grace window. A probe error is treated as "still alive" so
      // a transient inspect failure does not abort a healthy startup.
      if (diagnostics?.isContainerRunning) {
        // A probe error is treated as "still alive" so a transient inspect
        // failure does not abort a healthy startup.
        const stillRunning = await diagnostics
          .isContainerRunning()
          .catch(() => true);
        if (!stillRunning) {
          throw new Error(
            `Container ${diagnostics.containerId} exited before becoming healthy at ${baseUrl}${await this.buildHealthDiagnosticInfo(diagnostics)}`,
          );
        }
      }

      await this.delay(HEALTH_CHECK_INTERVAL_MS);
    }

    throw new Error(
      `Container health check timed out after ${timeoutMs}ms at ${baseUrl}${await this.buildHealthDiagnosticInfo(diagnostics)}`,
    );
  }

  /** Best-effort tail of container logs for embedding in a health-wait error. */
  private async buildHealthDiagnosticInfo(
    diagnostics?: HealthCheckDiagnostics,
  ): Promise<string> {
    if (!diagnostics) {
      return '';
    }
    try {
      const logs = await diagnostics.fetchLogs();
      const tail = logs.split('\n').slice(-20).join('\n');
      // The raw log tail carries NUL/control bytes from Docker's multiplex frame
      // headers. Sanitize at the source so this error message stays DB-safe for
      // every downstream consumer — the emitted execution.failed event AND the
      // run_command result an agent may persist via set_job_output.
      const safeTail = sanitizeJsonSafeLogText(tail);
      return `\n--- Container ${diagnostics.containerId} logs (last 20 lines) ---\n${safeTail}\n--- end logs ---`;
    } catch {
      return `\n(Unable to fetch logs for container ${diagnostics.containerId})`;
    }
  }

  async executeAgent(
    baseUrl: string,
    request: ContainerAgentRequest,
  ): Promise<ContainerAgentResponse> {
    return this.httpPostJson<ContainerAgentResponse>(
      `${baseUrl}/execute/agent`,
      request,
    );
  }

  async executeAgentAsync(
    baseUrl: string,
    request: ContainerAgentRequest,
  ): Promise<{ ok: boolean; accepted: boolean }> {
    return this.httpPostJson<{ ok: boolean; accepted: boolean }>(
      `${baseUrl}/execute/agent`,
      { ...request, mode: 'async' },
      AGENT_ASYNC_ACCEPT_TIMEOUT_MS,
    );
  }

  async executeCommand(
    baseUrl: string,
    request: ContainerCommandRequest,
  ): Promise<ContainerCommandResponse> {
    return this.httpPostJson<ContainerCommandResponse>(
      `${baseUrl}/execute/command`,
      request,
    );
  }

  async shutdown(baseUrl: string): Promise<void> {
    try {
      await this.httpPostJson(`${baseUrl}/shutdown`, {});
    } catch {
      // Best-effort — container may already be stopping
    }
  }

  /**
   * Public, generic HTTP GET with a caller-supplied timeout and full
   * response metadata (status, headers, body). Used by the
   * `service_mesh_header` and `custom_http_endpoint` orchestrator IP
   * resolution strategies in `apps/api/src/execution-lifecycle/` —
   * both need to inspect response headers (`X-Orchestrator-Ip` and
   * `Content-Type` respectively) before deciding whether the body is
   * usable. Kept on the existing service rather than introduced as a
   * new HTTP client because (a) the same node:http wiring is already
   * proven by `waitForHealth` / `executeAgent`, (b) consumers in
   * `execution-lifecycle` already depend on `DockerModule` for
   * `ContainerOrchestratorService`, and (c) the timeout / header
   * surface is small enough that a separate client would be premature.
   *
   * Non-2xx responses resolve (do NOT reject) with the status code in
   * the result — callers inspect `statusCode` and decide whether to
   * raise a typed error. Connection-level errors (refused, DNS
   * failure, timeout) reject with the raw `Error`.
   */
  async httpGetRaw(
    url: string,
    options: { timeoutMs?: number } = {},
  ): Promise<{
    statusCode: number;
    headers: http.IncomingHttpHeaders;
    body: string;
  }> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: timeoutMs }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`HTTP GET timed out after ${timeoutMs}ms: ${url}`));
      });
    });
  }

  private httpGet(url: string): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.get(url, { timeout: 5_000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 500,
            body: Buffer.concat(chunks).toString('utf-8'),
          });
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('HTTP GET timed out'));
      });
    });
  }

  private async httpPostJson<T>(
    url: string,
    body: unknown,
    timeoutMs?: number,
  ): Promise<T> {
    const payload = JSON.stringify(body);

    return new Promise<T>((resolve, reject) => {
      const parsedUrl = new URL(url);
      const req = http.request(
        {
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
          timeout:
            timeoutMs ??
            resolveAgentPostTimeoutMs(
              process.env.WORKFLOW_AGENT_HTTP_TIMEOUT_MS,
            ),
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf-8');

            if ((res.statusCode ?? 500) >= 400) {
              reject(new Error(`HTTP ${res.statusCode} from ${url}: ${raw}`));
              return;
            }

            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              reject(new Error(`Invalid JSON from ${url}: ${raw}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`HTTP POST timed out: ${url}`));
      });

      req.write(payload);
      req.end();
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
