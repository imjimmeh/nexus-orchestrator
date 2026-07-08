import type { GatewayEventPayload } from './types';

/**
 * Extracts the structured `result.details` object from a tool-execution
 * payload. Returns undefined when the result is missing or malformed so
 * callers can treat the failure case uniformly.
 */
function getToolResultDetails(
  payload: GatewayEventPayload,
): Record<string, unknown> | undefined {
  const result =
    payload.result && typeof payload.result === 'object'
      ? (payload.result as Record<string, unknown>)
      : undefined;
  if (!result) {
    return undefined;
  }

  const details = result.details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return undefined;
  }

  return details as Record<string, unknown>;
}

/**
 * True when the tool-execution payload reports a terminal failure. Tool
 * harnesses may signal a failure either via the top-level `isError` flag or
 * via `result.details.ok === false`; both shapes are accepted.
 */
export function hasToolExecutionFailure(payload: GatewayEventPayload): boolean {
  if (payload.isError === true) {
    return true;
  }

  const details = getToolResultDetails(payload);
  return details?.ok === false;
}
