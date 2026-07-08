import type { GatewayEventPayload } from './types';

/** Fallback failure context when a terminal failure has no specific message. */
export const AGENT_REPORTED_FAILURE_MESSAGE = 'Agent reported failure';

/**
 * Extracts a non-empty `output.errorMessage` from a turn/agent payload, or
 * undefined when the turn carried no error.
 */
export function getTurnEndErrorMessage(
  payload: GatewayEventPayload,
): string | undefined {
  const output =
    payload.output && typeof payload.output === 'object'
      ? (payload.output as Record<string, unknown>)
      : undefined;

  const errorMessage = output?.errorMessage;
  if (typeof errorMessage !== 'string') {
    return undefined;
  }

  const trimmed = errorMessage.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getOutputValue(payload: GatewayEventPayload, key: string): unknown {
  const output =
    payload.output && typeof payload.output === 'object'
      ? (payload.output as Record<string, unknown>)
      : undefined;

  return output?.[key];
}

function getTerminalStopReason(
  payload: GatewayEventPayload,
): string | undefined {
  const stopReason = getOutputValue(payload, 'stopReason');
  return typeof stopReason === 'string' && stopReason.trim().length > 0
    ? stopReason.trim()
    : undefined;
}

/** True when the payload itself reports a terminal failure (ok:false / error / aborted). */
export function hasTerminalAgentFailure(payload: GatewayEventPayload): boolean {
  if (getOutputValue(payload, 'ok') === false) {
    return true;
  }

  const stopReason = getTerminalStopReason(payload);
  return stopReason === 'error' || stopReason === 'aborted';
}

export function getTerminalFailureContext(
  payload: GatewayEventPayload,
): string | undefined {
  if (!hasTerminalAgentFailure(payload)) {
    return undefined;
  }

  return (
    getTurnEndErrorMessage(payload) ??
    getTerminalStopReason(payload) ??
    AGENT_REPORTED_FAILURE_MESSAGE
  );
}
