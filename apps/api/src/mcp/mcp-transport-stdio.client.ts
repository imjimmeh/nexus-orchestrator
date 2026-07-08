import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import type { McpServer } from './database/entities/mcp-server.entity';
import { SecretReferenceResolver } from '../security/secret-reference-resolver.service';
import {
  createCallToolRequest,
  createInitializeRequest,
  createInitializedNotification,
  createListToolsRequest,
  parseJsonRpcResponse,
  parseToolCallResult,
  parseToolsListResult,
} from './mcp-jsonrpc.utils';
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  McpToolsListResult,
} from '@nexus/core';
import type { McpToolCallResult } from './mcp.types';

interface PendingRequest {
  resolve: (value: JsonRpcResponse) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

class StdioJsonRpcSession {
  private readonly logger = new Logger(StdioJsonRpcSession.name);
  private readonly pending = new Map<number, PendingRequest>();
  private readonly stderrBuffer: string[] = [];
  private nextRequestId = 1;
  private stdoutBuffer = Buffer.alloc(0);

  constructor(
    private readonly process: ChildProcessWithoutNullStreams,
    private readonly timeoutMs: number,
  ) {
    this.process.stdout.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    this.process.stderr.on('data', (chunk: Buffer) => {
      const line = chunk.toString('utf8').trim();
      if (line.length > 0) {
        this.stderrBuffer.push(line);
      }
    });

    this.process.on('error', (error) => {
      this.rejectAllPending(error);
    });

    this.process.on('exit', (code, signal) => {
      this.rejectAllPending(
        new Error(
          `MCP stdio process exited (code=${String(code)}, signal=${String(signal)})`,
        ),
      );
    });
  }

  async initialize(): Promise<void> {
    await this.sendRequest(createInitializeRequest(this.nextId()));
    this.sendNotification(createInitializedNotification());
  }

  async listTools(): Promise<McpToolsListResult> {
    const response = await this.sendRequest(
      createListToolsRequest(this.nextId()),
    );
    return parseToolsListResult(response.result);
  }

  async callTool(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const response = await this.sendRequest(
      createCallToolRequest(this.nextId(), toolName, params),
    );
    return parseToolCallResult(response.result);
  }

  close(): void {
    if (!this.process.killed) {
      this.process.kill();
    }
  }

  private async sendRequest(payload: JsonRpcRequest): Promise<JsonRpcResponse> {
    const requestId = payload.id;
    if (typeof requestId !== 'number') {
      throw new Error('JSON-RPC request id must be a number');
    }

    const promise = new Promise<JsonRpcResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(
          new Error(
            `MCP stdio request timed out (id=${String(requestId)}). stderr=${this.stderrTail()}`,
          ),
        );
      }, this.timeoutMs);

      this.pending.set(requestId, {
        resolve,
        reject,
        timeout,
      });
    });

    this.writePayload(payload);
    const response = await promise;

    if (response.error) {
      throw new Error(
        `MCP stdio request failed (${String(response.error.code)}): ${response.error.message}`,
      );
    }

    if (response.result === undefined) {
      throw new Error('MCP stdio response did not include result');
    }

    return response;
  }

  private sendNotification(payload: JsonRpcRequest): void {
    this.writePayload(payload);
  }

  private writePayload(payload: JsonRpcRequest): void {
    const body = JSON.stringify(payload);
    const header = `Content-Length: ${String(Buffer.byteLength(body, 'utf8'))}\r\n\r\n`;
    this.process.stdin.write(`${header}${body}`);
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk]);

    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n');
      if (headerEnd === -1) {
        return;
      }

      const header = this.stdoutBuffer.slice(0, headerEnd).toString('utf8');
      const contentLength = this.parseContentLength(header);
      if (contentLength === null) {
        this.logger.warn('Dropping malformed MCP stdio frame header');
        this.stdoutBuffer = this.stdoutBuffer.slice(headerEnd + 4);
        continue;
      }

      const frameLength = headerEnd + 4 + contentLength;
      if (this.stdoutBuffer.length < frameLength) {
        return;
      }

      const body = this.stdoutBuffer
        .slice(headerEnd + 4, frameLength)
        .toString('utf8');
      this.stdoutBuffer = this.stdoutBuffer.slice(frameLength);

      this.handleJsonRpcMessage(body);
    }
  }

  private parseContentLength(header: string): number | null {
    const line = header
      .split('\r\n')
      .find((item) => item.toLowerCase().startsWith('content-length:'));

    if (!line) {
      return null;
    }

    const value = line.split(':')[1]?.trim();
    if (!value) {
      return null;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }

    return parsed;
  }

  private handleJsonRpcMessage(body: string): void {
    let payload: unknown;
    try {
      payload = JSON.parse(body) as unknown;
    } catch {
      this.logger.warn('Failed to parse MCP stdio JSON payload');
      return;
    }

    const response = parseJsonRpcResponse(payload);
    if (typeof response.id !== 'number') {
      return;
    }

    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }

    clearTimeout(pending.timeout);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new Error(
          `MCP stdio request aborted (id=${String(id)}): ${error.message}`,
        ),
      );
    }
    this.pending.clear();
  }

  private stderrTail(): string {
    if (this.stderrBuffer.length === 0) {
      return 'none';
    }

    return this.stderrBuffer.slice(-3).join(' | ');
  }

  private nextId(): number {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return id;
  }
}

@Injectable()
export class McpStdioTransportClient {
  constructor(
    private readonly secretReferenceResolver?: SecretReferenceResolver,
  ) {}

  async listTools(server: McpServer): Promise<McpToolsListResult> {
    const session = await this.openSession(server);
    try {
      return await session.listTools();
    } finally {
      session.close();
    }
  }

  async callTool(
    server: McpServer,
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    const session = await this.openSession(server);
    try {
      return await session.callTool(toolName, params);
    } finally {
      session.close();
    }
  }

  private async openSession(server: McpServer): Promise<StdioJsonRpcSession> {
    if (!server.command) {
      throw new Error('Stdio MCP server is missing command');
    }

    const resolvedEnv = await this.resolveEnv(server);

    const child = await this.spawnProcess(server.command, server.args ?? [], {
      connectTimeoutMs: server.connect_timeout_ms,
      resolvedEnv,
    });

    const session = new StdioJsonRpcSession(child, server.timeout_ms);
    await session.initialize();
    return session;
  }

  private async resolveEnv(
    server: McpServer,
  ): Promise<Record<string, string> | null> {
    if (this.secretReferenceResolver) {
      return this.secretReferenceResolver.resolveMap({
        secretId: server.env_secret_id,
        plaintext: server.env,
        purpose: 'env',
        serverName: server.name,
      });
    }
    // Fallback when the transport is constructed without DI (e.g. some
    // unit tests) — fall back to the plaintext env column so behaviour
    // matches the production runtime path for the legacy case.
    return server.env ?? null;
  }

  private async spawnProcess(
    command: string,
    args: string[],
    options: {
      connectTimeoutMs: number;
      resolvedEnv: Record<string, string> | null;
    },
  ): Promise<ChildProcessWithoutNullStreams> {
    const env = options.resolvedEnv
      ? { ...process.env, ...options.resolvedEnv }
      : process.env;

    const child = spawn(command, args, {
      stdio: 'pipe',
      windowsHide: true,
      env,
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        child.kill();
        reject(
          new Error(
            `Timed out waiting for MCP stdio process to spawn: ${command}`,
          ),
        );
      }, options.connectTimeoutMs);

      const onSpawn = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        clearTimeout(timeout);
        child.off('spawn', onSpawn);
        child.off('error', onError);
      };

      child.once('spawn', onSpawn);
      child.once('error', onError);
    });

    return child;
  }
}
