import { Injectable } from '@nestjs/common';
import type { McpServer } from './database/entities/mcp-server.entity';
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
  McpToolsListResult,
  JsonRpcResponse,
} from '@nexus/core';
import type { McpRuntimeContext, McpToolCallResult } from './mcp.types';
import {
  createTimeoutController,
  parseErrorBody,
  parseResponseBody,
} from '../common/http/http-client.utils';
import { SecretReferenceResolver } from '../security/secret-reference-resolver.service';

@Injectable()
export class McpHttpTransportClient {
  private nextRequestId = 1;
  private initialized = false;

  constructor(
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async listTools(server: McpServer): Promise<McpToolsListResult> {
    await this.ensureInitialized(server);
    const payload = createListToolsRequest(this.nextId());
    const response = await this.sendRequest(server, payload);
    return parseToolsListResult(response.result);
  }

  async callTool(
    server: McpServer,
    toolName: string,
    params: Record<string, unknown>,
    runtimeContext?: McpRuntimeContext,
  ): Promise<McpToolCallResult> {
    await this.ensureInitialized(server);
    const payload = createCallToolRequest(this.nextId(), toolName, params);
    const response = await this.sendRequest(server, payload, runtimeContext);
    return parseToolCallResult(response.result);
  }

  private async ensureInitialized(server: McpServer): Promise<void> {
    if (this.initialized) {
      return;
    }

    const initializeRequest = createInitializeRequest(this.nextId());
    await this.sendRequest(server, initializeRequest);

    await this.sendNotification(server, createInitializedNotification());
    this.initialized = true;
  }

  private async sendRequest(
    server: McpServer,
    payload: JsonRpcRequest,
    runtimeContext?: McpRuntimeContext,
  ): Promise<JsonRpcResponse> {
    const responseBody = await this.executeFetch(
      server,
      payload,
      runtimeContext,
    );
    const parsed = parseJsonRpcResponse(responseBody);

    if (parsed.error) {
      throw new Error(
        `MCP HTTP request failed (${String(parsed.error.code)}): ${parsed.error.message}`,
      );
    }

    if (parsed.result === undefined) {
      throw new Error('MCP HTTP response did not include result');
    }

    return parsed;
  }

  private async sendNotification(
    server: McpServer,
    payload: JsonRpcRequest,
  ): Promise<void> {
    await this.executeFetch(server, payload);
  }

  private async executeFetch(
    server: McpServer,
    payload: JsonRpcRequest,
    runtimeContext?: McpRuntimeContext,
  ): Promise<unknown> {
    if (!server.url) {
      throw new Error('HTTP MCP server is missing url');
    }

    const { controller, cleanup } = createTimeoutController(server.timeout_ms);
    const headers = await this.resolveHeaders(server, runtimeContext);

    const response = await fetch(server.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    cleanup();

    if (!response.ok) {
      const errorBody = await parseErrorBody(response);
      throw new Error(
        `MCP HTTP request failed with status ${String(response.status)}: ${JSON.stringify(errorBody.data)}`,
      );
    }

    return parseResponseBody<unknown>(response);
  }

  private async resolveHeaders(
    server: McpServer,
    runtimeContext?: McpRuntimeContext,
  ): Promise<Record<string, string>> {
    const resolved = await this.secretReferenceResolver.resolveMap({
      secretId: server.headers_secret_id,
      plaintext: server.headers,
      purpose: 'headers',
      serverName: server.name,
    });
    return {
      'content-type': 'application/json',
      ...(resolved ?? {}),
      ...this.toRuntimeHeaders(runtimeContext),
    };
  }

  private toRuntimeHeaders(
    runtimeContext?: McpRuntimeContext,
  ): Record<string, string> {
    return {
      ...(runtimeContext?.workflowRunId
        ? { 'x-workflow-run-id': runtimeContext.workflowRunId }
        : {}),
      ...(runtimeContext?.jobId ? { 'x-job-id': runtimeContext.jobId } : {}),
      ...(runtimeContext?.stepId ? { 'x-step-id': runtimeContext.stepId } : {}),
      // Scope-aware MCP servers infer their domain id (e.g. project) from scope
      // rather than requiring the agent to pass it explicitly. x-scope-id is the
      // canonical header those servers read first.
      ...(runtimeContext?.scopeId
        ? { 'x-scope-id': runtimeContext.scopeId }
        : {}),
    };
  }

  private nextId(): number {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    return id;
  }
}
