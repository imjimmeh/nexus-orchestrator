/**
 * Shared HTTP utilities for tool callbacks.
 *
 * These helpers are consumed by both api-callback.ts and external-mcp-callback.ts.
 * They have no dependency on any specific callback type, keeping each callback
 * module focused on its own transport logic.
 */

/**
 * Decode the JWT payload segment and extract runtime context header values.
 * Returns only the headers whose values are non-empty strings.
 */
export function decodeRuntimeContextHeaders(
  agentJwt: string,
): Record<string, string> {
  const payload = decodeJwtPayload(agentJwt);
  const workflowRunId = readNonEmptyString(payload.workflowRunId);
  const jobId = readNonEmptyString(payload.jobId);
  const stepId = readNonEmptyString(payload.stepId);
  const scopeId = readNonEmptyString(payload.scopeId);

  return {
    ...(workflowRunId ? { "x-workflow-run-id": workflowRunId } : {}),
    ...(jobId ? { "x-job-id": jobId } : {}),
    ...(stepId ? { "x-step-id": stepId } : {}),
    ...(scopeId ? { "x-correlation-id": scopeId } : {}),
  };
}

/**
 * Base64url-decode and JSON-parse a JWT token's payload segment.
 * Returns an empty object when parsing fails or the token is malformed.
 */
export function decodeJwtPayload(token: string): Record<string, unknown> {
  const encodedPayload = token.split(".")[1];
  if (!encodedPayload) {
    return {};
  }

  try {
    const normalized = encodedPayload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const parsed: unknown = JSON.parse(
      Buffer.from(padded, "base64").toString("utf-8"),
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Returns the trimmed value if it is a non-empty string, otherwise `null`. */
export function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Normalize a parsed JSON response body so that array responses are wrapped
 * under a `raw` key, keeping the return type consistent for spread operations.
 */
export function normalizeCallbackResponseData(
  responseData: Record<string, unknown>,
): Record<string, unknown> {
  if (Array.isArray(responseData)) {
    return { raw: JSON.stringify(responseData) };
  }

  return responseData;
}

/**
 * Attempt to parse `text` as JSON; return `{ raw: text }` on failure so
 * callers always receive a plain object.
 */
export function parseJsonSafe(text: string): Record<string, unknown> {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { raw: text };
  }
}
