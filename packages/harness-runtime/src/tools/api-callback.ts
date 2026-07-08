import { classifyAgentErrorFeedback } from "@nexus/core";
import type { AgentErrorFeedback } from "@nexus/core";
import { Agent as UndiciAgent } from "undici";

import type { ToolCallResult } from "../engine/session-context.js";
import { executeExternalMcpCallback } from "./external-mcp-callback.js";
import type { MountedToolExternalMcpCallback } from "./external-mcp-callback.types.js";
import {
  decodeRuntimeContextHeaders,
  normalizeCallbackResponseData,
  parseJsonSafe,
  readNonEmptyString,
} from "./http-utils.js";

interface MountedToolApiCallback {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path_template?: string;
  body_mapping?: Record<string, string>;
  external_mcp?: MountedToolExternalMcpCallback;
}

const API_CALLBACK_DEFAULT_MAX_ATTEMPTS = 6;

function resolveMaxAttempts(raw: string | undefined): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : API_CALLBACK_DEFAULT_MAX_ATTEMPTS;
}

const API_CALLBACK_MAX_ATTEMPTS = resolveMaxAttempts(
  process.env.NEXUS_API_CALLBACK_MAX_ATTEMPTS,
);
const API_CALLBACK_RETRY_BASE_MS = 500;
const API_CALLBACK_RETRY_MAX_MS = 8_000;
const API_CALLBACK_RETRIABLE_STATUS_CODES = new Set([
  408, 425, 429, 500, 502, 503, 504,
]);
const CALLBACK_BODY_ALL_TOOL_PARAMS_KEY = "__tool_params__";

const LONG_POLL_AGENT = new UndiciAgent({
  headersTimeout: 3_600_000,
  bodyTimeout: 3_600_000,
});

export async function executeApiCallback(params: {
  toolName: string;
  callback: MountedToolApiCallback;
  toolParams: Record<string, unknown>;
  apiBaseUrl: string;
  agentJwt: string;
}): Promise<ToolCallResult<Record<string, unknown>>> {
  if (params.callback.external_mcp) {
    const mappedToolParams = buildCallbackBody(
      params.callback,
      params.toolParams,
      new Set(),
    );
    return executeExternalMcpCallback({
      toolName: params.toolName,
      callback: params.callback.external_mcp,
      toolParams: mappedToolParams,
      agentJwt: params.agentJwt,
    });
  }

  if (!params.callback.path_template) {
    return {
      content: [
        {
          type: "text",
          text: `Tool ${params.toolName} API callback is missing path_template.`,
        },
      ],
      details: { ok: false, error: "missing_api_callback_path_template" },
    };
  }

  const scopeValidation = validateProjectScopedToolParams(
    params.toolName,
    params.toolParams,
  );
  if (scopeValidation) {
    return scopeValidation;
  }

  const resolvedPath = resolvePathTemplate(
    params.callback.path_template,
    params.toolParams,
  );
  const body = buildCallbackBody(
    params.callback,
    params.toolParams,
    resolvedPath.consumedKeys,
  );
  const url = `${params.apiBaseUrl}${resolvedPath.path}`;

  let lastErrorMessage: string | null = null;

  for (let attempt = 1; attempt <= API_CALLBACK_MAX_ATTEMPTS; attempt += 1) {
    const attemptResult = await executeApiCallbackAttempt({
      toolName: params.toolName,
      method: params.callback.method,
      url,
      body,
      agentJwt: params.agentJwt,
      attempt,
      canRetry: attempt < API_CALLBACK_MAX_ATTEMPTS,
    });

    if (
      attemptResult.kind === "retry" ||
      attemptResult.kind === "network_error"
    ) {
      if (attemptResult.kind === "network_error") {
        lastErrorMessage = attemptResult.message;
      }
      if (attempt < API_CALLBACK_MAX_ATTEMPTS) {
        const delay = Math.min(
          API_CALLBACK_RETRY_MAX_MS,
          API_CALLBACK_RETRY_BASE_MS * 2 ** (attempt - 1),
        );
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
      continue;
    }

    return attemptResult.result;
  }

  const message = lastErrorMessage ?? "Unknown network error";
  console.error(`[api-callback] ${params.toolName} error: ${message}`);
  return {
    content: [
      {
        type: "text",
        text: `Tool ${params.toolName} API call failed: ${message}`,
      },
    ],
    details: { ok: false, error: message, attempt: API_CALLBACK_MAX_ATTEMPTS },
  };
}

type ApiCallbackAttemptResult =
  | {
      kind: "result";
      result: ToolCallResult<Record<string, unknown>>;
    }
  | { kind: "retry" }
  | { kind: "network_error"; message: string };

async function executeApiCallbackAttempt(params: {
  toolName: string;
  method: MountedToolApiCallback["method"];
  url: string;
  body: Record<string, unknown>;
  agentJwt: string;
  attempt: number;
  canRetry: boolean;
}): Promise<ApiCallbackAttemptResult> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${params.agentJwt}`,
      ...decodeRuntimeContextHeaders(params.agentJwt),
    };

    const requestInit: RequestInit & { dispatcher?: UndiciAgent } = {
      method: params.method,
      headers,
      dispatcher: LONG_POLL_AGENT,
    };

    if (params.method !== "GET") {
      headers["Content-Type"] = "application/json";
      requestInit.body = JSON.stringify(params.body);
    }

    const response = await fetch(params.url, requestInit);

    const responseText = await response.text();
    const responseData = parseJsonSafe(responseText);

    if (!response.ok) {
      if (
        params.canRetry &&
        API_CALLBACK_RETRIABLE_STATUS_CODES.has(response.status)
      ) {
        return { kind: "retry" };
      }

      return {
        kind: "result",
        result: buildApiCallbackFailureResult({
          toolName: params.toolName,
          status: response.status,
          responseText,
          responseData,
          attempt: params.attempt,
        }),
      };
    }

    return {
      kind: "result",
      result: buildApiCallbackSuccessResult({
        toolName: params.toolName,
        status: response.status,
        responseText,
        responseData,
        attempt: params.attempt,
      }),
    };
  } catch (error) {
    return {
      kind: "network_error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function validateProjectScopedToolParams(
  toolName: string,
  toolParams: Record<string, unknown>,
): ToolCallResult<Record<string, unknown>> | null {
  if (!toolName.startsWith("kanban.")) {
    return null;
  }

  const projectId = readNonEmptyString(
    toolParams.project_id ?? toolParams.projectId,
  );
  if (projectId !== "default") {
    return null;
  }

  return {
    content: [
      {
        type: "text",
        text: "Project id was not resolved; expected trigger context scopeId. Check workflow prompt and job input templating before retrying this tool.",
      },
    ],
    details: {
      ok: false,
      error: "unresolved_project_id",
      toolName,
    },
  };
}

function buildApiCallbackFailureResult(params: {
  toolName: string;
  status: number;
  responseText: string;
  responseData: Record<string, unknown>;
  attempt: number;
}): ToolCallResult<Record<string, unknown>> {
  const feedback = applyStructuredCallbackFeedback(
    classifyAgentErrorFeedback({
      action: params.toolName,
      error: `Tool ${params.toolName} API call failed (HTTP ${String(params.status)}): ${params.responseText}`,
      defaultSummary: `Tool ${params.toolName} API call failed`,
    }),
    params.responseData,
  );

  const detailText = extractErrorDetailText(
    params.responseData,
    params.responseText,
  );
  const contentText =
    detailText.length > 0
      ? `${feedback.summary} ${feedback.suggested_fix}\nDetails: ${detailText}`
      : `${feedback.summary} ${feedback.suggested_fix}`;

  return {
    content: [
      {
        type: "text",
        text: contentText,
      },
    ],
    details: {
      ok: false,
      status: params.status,
      attempt: params.attempt,
      error_feedback: feedback,
      ...normalizeCallbackResponseData(params.responseData),
    },
  };
}

function applyStructuredCallbackFeedback(
  feedback: AgentErrorFeedback,
  responseData: Record<string, unknown>,
): AgentErrorFeedback {
  const retryable =
    typeof responseData.retryable === "boolean"
      ? responseData.retryable
      : feedback.retryable;
  const recommendedAction = readNonEmptyString(responseData.recommended_action);
  const errorCode = readNonEmptyString(responseData.code);
  const context: Record<string, unknown> = { ...(feedback.context ?? {}) };

  if (recommendedAction) {
    context.recommended_action = recommendedAction;
  }
  if (Array.isArray(responseData.active_subagent_ids)) {
    context.active_subagent_ids = responseData.active_subagent_ids;
  }

  return {
    ...feedback,
    ...(errorCode ? { error_code: errorCode } : {}),
    retryable,
    ...(recommendedAction
      ? { suggested_fix: `Recommended action: ${recommendedAction}.` }
      : {}),
    context,
  };
}

function extractErrorDetailText(
  responseData: Record<string, unknown>,
  responseText: string,
): string {
  const directMessage = pickFirstNonEmptyString([
    responseData.message,
    responseData.error,
    responseData.raw,
  ]);

  if (directMessage) {
    return truncateErrorDetail(directMessage);
  }

  const nestedDetails = responseData.details;
  if (
    nestedDetails &&
    typeof nestedDetails === "object" &&
    !Array.isArray(nestedDetails)
  ) {
    const nestedMessage = pickFirstNonEmptyString([
      (nestedDetails as Record<string, unknown>).message,
      (nestedDetails as Record<string, unknown>).error,
    ]);
    if (nestedMessage) {
      return truncateErrorDetail(nestedMessage);
    }
  }

  const errors = responseData.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    const formatted = errors
      .map((entry) => {
        if (!entry || typeof entry !== "object") {
          return "";
        }
        const record = entry as Record<string, unknown>;
        const path = pickFirstNonEmptyString([record.path, record.field]);
        const message = pickFirstNonEmptyString([record.message, record.code]);
        if (path && message) {
          return `${path}: ${message}`;
        }
        return message ?? "";
      })
      .filter((entry) => entry.length > 0)
      .join(", ");

    if (formatted.length > 0) {
      return truncateErrorDetail(formatted);
    }
  }

  return truncateErrorDetail(responseText.trim());
}

function pickFirstNonEmptyString(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }

    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }

  return null;
}

function truncateErrorDetail(detail: string): string {
  const MAX_DETAIL_LENGTH = 1500;
  if (detail.length <= MAX_DETAIL_LENGTH) {
    return detail;
  }

  return `${detail.slice(0, MAX_DETAIL_LENGTH)}...(truncated)`;
}

/**
 * Terminate directives instruct the runner to end the agent's turn NOW. Without
 * them the agent keeps issuing tool calls in the same turn:
 *   - `suspended` (durable agent-await): park until awaited children finish,
 *     else await_agent_workflow loops (see kanban-atuq).
 *   - `completed`: the agent signalled step completion (step_complete); the
 *     engine has already finalized the step, so the agent must stop rather than
 *     re-spawning subagents and re-calling step_complete in a dead loop.
 *   - `terminated`: the workflow run is terminal; no further tool calls are
 *     accepted, so abort immediately.
 */
const TERMINATE_EXECUTION_STATUSES = new Set([
  "suspended",
  "completed",
  "terminated",
]);

function readStringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/**
 * Detects a terminate directive. The directive may be top-level (step_complete
 * responses) or nested under `data` (camelCase, e.g. AwaitAgentWorkflowResponse).
 * Engines read the returned `terminate` flag to abort the in-flight turn.
 */
function shouldTerminateTurn(
  responseData: Record<string, unknown>,
  nestedData: Record<string, unknown> | undefined,
): boolean {
  const executionStatus =
    readStringField(nestedData?.executionStatus) ??
    readStringField(responseData.executionStatus);
  return (
    executionStatus !== undefined &&
    TERMINATE_EXECUTION_STATUSES.has(executionStatus)
  );
}

export function buildApiCallbackSuccessResult(params: {
  toolName: string;
  status: number;
  responseText: string;
  responseData: Record<string, unknown>;
  attempt: number;
}): ToolCallResult<Record<string, unknown>> {
  const resultText = formatApiCallbackResultText(
    params.toolName,
    params.responseData,
    params.responseText,
  );

  const dataOk =
    typeof params.responseData.ok === "boolean" ? params.responseData.ok : true;
  const nestedData =
    typeof params.responseData.data === "object" &&
    params.responseData.data !== null
      ? (params.responseData.data as Record<string, unknown>)
      : undefined;
  const executionFailed =
    nestedData?.execution_status === "failed" || nestedData?.ok === false;

  const terminate = shouldTerminateTurn(params.responseData, nestedData);

  return {
    content: [
      {
        type: "text",
        text: resultText,
      },
    ],
    ...(terminate ? { terminate: true } : {}),
    details: {
      ok: dataOk && !executionFailed,
      action: `${params.toolName}_completed`,
      status: params.status,
      attempt: params.attempt,
      ...params.responseData,
    },
  };
}

export function formatApiCallbackResultText(
  _toolName: string,
  responseData: Record<string, unknown>,
  responseText: string,
): string {
  const nestedData = responseData.data as Record<string, unknown> | undefined;

  if (nestedData && typeof nestedData._markdown === "string") {
    return nestedData._markdown;
  }

  if (Object.keys(responseData).length > 0) {
    return JSON.stringify(responseData, null, 2);
  }

  return responseText;
}

function resolvePathTemplate(
  template: string,
  toolParams: Record<string, unknown>,
): { path: string; consumedKeys: Set<string> } {
  const consumedKeys = new Set<string>();
  const path = template.replaceAll(/\{(\w+)\}/g, (_match, key: string) => {
    consumedKeys.add(key);
    const value = toolParams[key];
    if (typeof value === "string") {
      return encodeURIComponent(value);
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return encodeURIComponent(String(value));
    }
    return "";
  });

  return { path, consumedKeys };
}

function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

export function buildCallbackBody(
  callback: MountedToolApiCallback,
  toolParams: Record<string, unknown>,
  pathParamKeys: Set<string>,
): Record<string, unknown> {
  const remainingToolParams = Object.fromEntries(
    Object.entries(toolParams).filter(([key]) => !pathParamKeys.has(key)),
  );

  if (callback.body_mapping) {
    const body: Record<string, unknown> = {};
    for (const [bodyField, paramKey] of Object.entries(callback.body_mapping)) {
      if (paramKey === CALLBACK_BODY_ALL_TOOL_PARAMS_KEY) {
        body[bodyField] = remainingToolParams;
        continue;
      }

      if (pathParamKeys.has(paramKey)) {
        continue;
      }

      if (toolParams[paramKey] !== undefined) {
        const rawValue = toolParams[paramKey];
        body[bodyField] = tryParseJson(rawValue);
      }
    }
    return body;
  }

  return remainingToolParams;
}
