import type {
  AgentEndOutput,
  SessionCompletionResult,
} from "./session-completion.types.js";

/**
 * Extracts a turn's failure message, or undefined when the turn succeeded.
 * A turn is failed when it reports `ok:false` or carries an `errorMessage`.
 */
export function extractTurnError(
  output: AgentEndOutput | undefined,
): string | undefined {
  const failed =
    output?.ok === false ||
    (typeof output?.errorMessage === "string" &&
      output.errorMessage.trim().length > 0);
  if (!failed) {
    return undefined;
  }
  const message = output?.errorMessage?.trim();
  return message && message.length > 0 ? message : "agent turn failed";
}

/**
 * Reconciles an agent_end output against the final turn's outcome.
 *
 * Some engines (notably PI) hardcode `ok:true` on agent_end even when the final
 * turn errored, masking the failure. When the last turn failed, the agent-level
 * result is forced to a failure carrying the turn's error so the executor and
 * telemetry see the truth rather than a synthetic success.
 */
export function reconcileAgentEnd(params: {
  agentOutput: AgentEndOutput | undefined;
  lastTurnError: string | undefined;
}): SessionCompletionResult {
  const reportedOk = params.agentOutput?.ok ?? true;
  const turnFailed = params.lastTurnError !== undefined;
  const ok = reportedOk && !turnFailed;
  const response = params.agentOutput?.response ?? "";

  if (ok) {
    // A deliberately-suspended turn is a success that must not be progressed:
    // surface the flag so the executor parks the run for durable resume.
    return params.agentOutput?.suspended === true
      ? { ok: true, response, suspended: true }
      : { ok: true, response };
  }

  const error =
    params.agentOutput?.errorMessage ??
    params.lastTurnError ??
    "agent reported failure";
  return { ok: false, response, error };
}

/**
 * Reconciles an agent_end event against the final turn outcome, returning the
 * completion result and the event to forward to telemetry. When the final turn
 * failed but the event masks it, the forwarded event is corrected to ok:false /
 * stopReason "error" so downstream consumers see the real outcome.
 */
export function reconcileAgentEndEvent<T extends { output?: AgentEndOutput }>(
  event: T,
  lastTurnError: string | undefined,
): { forward: T; completion: SessionCompletionResult } {
  const completion = reconcileAgentEnd({
    agentOutput: event.output,
    lastTurnError,
  });
  if (completion.ok) {
    return { forward: event, completion };
  }

  const stopReason =
    event.output?.stopReason && event.output.stopReason !== "end_turn"
      ? event.output.stopReason
      : "error";
  const forward = {
    ...event,
    output: {
      ...event.output,
      ok: false,
      errorMessage: completion.error,
      stopReason,
    },
  };
  return { forward, completion };
}
