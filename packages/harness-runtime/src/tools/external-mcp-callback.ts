import type { ToolCallResult } from "../engine/session-context.js";
import type { MountedToolExternalMcpCallback } from "./external-mcp-callback.types.js";
import {
  decodeRuntimeContextHeaders,
  normalizeCallbackResponseData,
  parseJsonSafe,
} from "./http-utils.js";

export async function executeExternalMcpCallback(params: {
  toolName: string;
  callback: MountedToolExternalMcpCallback;
  toolParams: Record<string, unknown>;
  agentJwt: string;
}): Promise<ToolCallResult<Record<string, unknown>>> {
  try {
    const headers = buildExternalMcpHeaders(
      params.callback.headers,
      params.agentJwt,
    );
    const response = await fetch(params.callback.url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: params.callback.remote_tool_name,
          arguments: params.toolParams,
        },
      }),
    });

    const responseText = await response.text();
    const responseData = parseJsonSafe(responseText);

    if (!response.ok) {
      return buildExternalMcpFailureResult({
        toolName: params.toolName,
        status: response.status,
        responseText,
        responseData,
        remoteToolName: params.callback.remote_tool_name,
      });
    }

    if (isRecord(responseData.error)) {
      return buildExternalMcpJsonRpcErrorResult({
        status: response.status,
        error: responseData.error,
        remoteToolName: params.callback.remote_tool_name,
      });
    }

    const result =
      isRecord(responseData.data) && isRecord(responseData.data.result)
        ? responseData.data.result
        : isRecord(responseData.result)
          ? responseData.result
          : {};
    return {
      content: [
        {
          type: "text",
          text: formatExternalMcpResultText(result),
        },
      ],
      details: {
        ok: true,
        action: `${params.toolName}_completed`,
        status: response.status,
        remote_tool_name: params.callback.remote_tool_name,
        result,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `External MCP tool ${params.toolName} network error: ${message}`,
        },
      ],
      details: { ok: false, error: message },
    };
  }
}

function buildExternalMcpHeaders(
  mountHeaders: Record<string, string> | undefined,
  agentJwt: string,
): Record<string, string> {
  const runtimeContextHeaders = decodeRuntimeContextHeaders(agentJwt);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...removeRuntimeContextHeaders(mountHeaders),
    ...runtimeContextHeaders,
  };

  const hasAuthorization = Object.keys(headers).some(
    (headerName) => headerName.toLowerCase() === "authorization",
  );
  if (!hasAuthorization) {
    headers.Authorization = `Bearer ${agentJwt}`;
  }

  return headers;
}

function removeRuntimeContextHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  if (!headers) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) =>
        ![
          "x-workflow-run-id",
          "x-step-id",
          "x-job-id",
          "x-correlation-id",
        ].includes(name.toLowerCase()),
    ),
  );
}

function buildExternalMcpFailureResult(params: {
  toolName: string;
  status: number;
  responseText: string;
  responseData: Record<string, unknown>;
  remoteToolName: string;
}): ToolCallResult<Record<string, unknown>> {
  return {
    content: [
      {
        type: "text",
        text: `External MCP tool ${params.toolName} failed (HTTP ${String(params.status)}): ${params.responseText}`,
      },
    ],
    details: {
      ok: false,
      status: params.status,
      remote_tool_name: params.remoteToolName,
      ...normalizeCallbackResponseData(params.responseData),
    },
  };
}

function buildExternalMcpJsonRpcErrorResult(params: {
  status: number;
  error: Record<string, unknown>;
  remoteToolName: string;
}): ToolCallResult<Record<string, unknown>> {
  const message =
    typeof params.error.message === "string"
      ? params.error.message
      : "External MCP tool failed";
  return {
    content: [{ type: "text", text: message }],
    details: {
      ok: false,
      status: params.status,
      remote_tool_name: params.remoteToolName,
      error: params.error,
    },
  };
}

function formatExternalMcpResultText(result: Record<string, unknown>): string {
  const content = result.content;
  if (Array.isArray(content)) {
    const text = content
      .map((item) =>
        isRecord(item) && typeof item.text === "string" ? item.text : null,
      )
      .filter((item): item is string => item !== null)
      .join("\n");
    if (text.length > 0) {
      return text;
    }
  }

  return JSON.stringify(result, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
