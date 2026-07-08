/**
 * Agent execution helpers for the harness runtime server.
 *
 * Extracted from server.ts to keep that module within the line budget.
 * Responsible for: session lifecycle, checkpoint wiring, foreground/background
 * execution modes, and event-driven completion tracking.
 */

import type { CanonicalSessionEvent, HarnessRuntimeConfig } from "@nexus/core";
import type {
  HarnessEngine,
  HarnessSession,
} from "../engine/harness-engine.js";
import type { HarnessSessionContext } from "../engine/session-context.js";
import type { OrchestratorClient } from "../gateway/orchestrator-client.js";
import type { HarnessEnvConfig } from "../config/config.js";
import {
  extractTurnError,
  reconcileAgentEndEvent,
} from "./session-completion.helpers.js";
import type { AgentEndOutput } from "./session-completion.types.js";
import { maybeCreateCheckpointWriter } from "./checkpoint-wiring.js";
import type {
  ExecuteAgentRequest,
  AgentStepResult,
} from "./server.execution.types.js";

export type {
  ExecuteAgentRequest,
  AgentStepResult,
} from "./server.execution.types.js";

const AGENT_SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

const DEFAULT_EXECUTION_KICKOFF_PROMPT =
  "Execute the assigned workflow step using your system instructions. Use tools as needed, then finish cleanly.";

// ---------------------------------------------------------------------------
// Auth resolution
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function resolveRequestAuth(
  request: ExecuteAgentRequest,
): HarnessRuntimeConfig["model"]["auth"] | undefined {
  const auth = request.auth;
  if (auth?.type === "api_key") {
    return isNonEmptyString(auth.apiKey) ? auth : undefined;
  }

  if (auth?.type === "oauth") {
    const credential = auth.credential;
    return isNonEmptyString(credential.refreshToken) &&
      isNonEmptyString(credential.accessToken) &&
      Number.isFinite(credential.expiresAt)
      ? auth
      : undefined;
  }

  return isNonEmptyString(request.apiKey)
    ? { type: "api_key", apiKey: request.apiKey }
    : undefined;
}

// ---------------------------------------------------------------------------
// Session completion tracking
// ---------------------------------------------------------------------------

interface SessionCompletionResult {
  ok: boolean;
  response: string;
  error?: string;
  suspended?: boolean;
}

/** Resolves with the session result, or a timeout failure after the cap. */
function awaitWithSessionTimeout(
  finished: Promise<SessionCompletionResult>,
): Promise<SessionCompletionResult> {
  return Promise.race([
    finished,
    new Promise<SessionCompletionResult>((resolve) => {
      setTimeout(() => {
        resolve({ ok: false, response: "", error: "Agent session timed out" });
      }, AGENT_SESSION_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Translate a canonical agent_telemetry event into its wire payload. The web
 * session view reads `payload.type` to recognise streaming sub-events (e.g.
 * text and thinking blocks), so the canonical `telemetryType` discriminator is
 * promoted to `type` and not duplicated on the wire.
 */
function toAgentTelemetryWirePayload(
  event: Extract<CanonicalSessionEvent, { type: "agent_telemetry" }>,
): Record<string, unknown> {
  const { type: _canonicalType, telemetryType, ...rest } = event;
  return { ...rest, type: telemetryType };
}

/**
 * Subscribe to a session's events and resolve a promise when the session ends.
 * Forwards events to the orchestrator client.
 */
function subscribeForCompletion(
  session: HarnessSession,
  client: OrchestratorClient,
  _ctx: { stepId: string; sessionId: string },
): { unsubscribe: () => void; finished: Promise<SessionCompletionResult> } {
  let resolve!: (result: SessionCompletionResult) => void;
  const finished = new Promise<SessionCompletionResult>((res) => {
    resolve = res;
  });

  // Track the most recent turn's outcome so a masked agent_end (some engines
  // hardcode ok:true) can be corrected to reflect a failed final turn.
  let lastTurnError: string | undefined;

  const unsubscribe = session.subscribe((event) => {
    if (event.type === "turn_end") {
      const turnOutput = (event as typeof event & { output?: AgentEndOutput })
        .output;
      lastTurnError = extractTurnError(turnOutput);
    }

    if (event.type === "agent_end") {
      // Correct a masked agent_end (some engines hardcode ok:true) so both the
      // step result and forwarded telemetry reflect a failed final turn.
      const { forward, completion } = reconcileAgentEndEvent(
        event as typeof event & { output?: AgentEndOutput },
        lastTurnError,
      );
      client.emit(event.type, forward);
      resolve(completion);
      return;
    }

    if (event.type === "agent_telemetry") {
      client.emit("agent_telemetry", toAgentTelemetryWirePayload(event));
      return;
    }

    client.emit(event.type, event);
  });

  return { unsubscribe, finished };
}

// ---------------------------------------------------------------------------
// Background / foreground execution
// ---------------------------------------------------------------------------

/**
 * Run an agent session in fire-and-forget mode. Errors are forwarded to the
 * client as agent_error events. The session and checkpoint writer are cleaned
 * up in the finally block regardless of outcome.
 */
/**
 * Log the full stack of an agent execution error to stderr. The runner otherwise
 * forwards only `error.message` via the `agent_error` event, which discards the
 * throw site — making SDK-internal failures (e.g. "Cannot continue from message
 * role: assistant") impossible to locate. stderr is captured by the API's
 * container log forwarder.
 */
function logAgentExecutionError(stepId: string, error: unknown): void {
  const detail =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(
    `[harness-runtime] agent execution threw for step ${stepId}:\n${detail}`,
  );
}

async function runAgentBackground(
  session: HarnessSession,
  client: OrchestratorClient,
  kickoffPrompt: string,
  finished: Promise<SessionCompletionResult>,
  stepId: string,
  checkpointWriter: { stop(): void } | undefined,
  unsubscribe: () => void,
): Promise<void> {
  try {
    await session.prompt(kickoffPrompt);
    const result = await awaitWithSessionTimeout(finished);
    if (!result.ok) {
      client.emit("agent_error", { message: result.error, stepId });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logAgentExecutionError(stepId, error);
    client.emit("agent_error", { message, stepId });
  } finally {
    checkpointWriter?.stop();
    unsubscribe();
    await session.dispose();
  }
}

/**
 * Run an agent session synchronously (foreground). Returns the step result,
 * forwarding prompt errors as agent_error events and cleaning up in all paths.
 */
async function runAgentForeground(
  session: HarnessSession,
  client: OrchestratorClient,
  kickoffPrompt: string,
  finished: Promise<SessionCompletionResult>,
  stepId: string,
  checkpointWriter: { stop(): void } | undefined,
  unsubscribe: () => void,
): Promise<AgentStepResult> {
  try {
    await session.prompt(kickoffPrompt);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logAgentExecutionError(stepId, error);
    client.emit("agent_error", { message, stepId });
    checkpointWriter?.stop();
    unsubscribe();
    await session.dispose();
    return { ok: false, response: "", error: message };
  }

  const result = await awaitWithSessionTimeout(finished);
  const producedSessionId = session.getProducedSessionId?.();
  checkpointWriter?.stop();
  unsubscribe();
  await session.dispose();

  return {
    ok: result.ok,
    response: result.response,
    error: result.ok ? undefined : result.error,
    ...(result.suspended ? { suspended: true } : {}),
    ...(producedSessionId ? { producedSessionId } : {}),
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function executeAgentStep(
  envConfig: HarnessEnvConfig,
  client: OrchestratorClient,
  engine: HarnessEngine,
  ctx: HarnessSessionContext,
  request: ExecuteAgentRequest,
): Promise<AgentStepResult> {
  const auth = resolveRequestAuth(request);
  if (!auth) {
    throw new Error("Missing required fields: auth");
  }

  const runnerConfig: HarnessRuntimeConfig = {
    harnessId: envConfig.harnessId,
    model: {
      provider: request.provider,
      model: request.model,
      auth,
      baseUrl: request.baseUrl,
      providerConfig: request.providerConfig,
      temperature: request.temperature ?? 0,
      thinkingLevel: request.thinkingLevel ?? "off",
    },
    prompt: {
      systemPrompt: request.systemPrompt,
      initialPrompt: request.initialPrompt,
    },
  };

  const session = await engine.createSession(runnerConfig, ctx);

  const checkpointWriter = maybeCreateCheckpointWriter(session, {
    harnessId: envConfig.harnessId,
    checkpointPath: process.env["SESSION_CHECKPOINT_PATH"],
  });

  const kickoffPrompt =
    typeof runnerConfig.prompt.initialPrompt === "string" &&
    runnerConfig.prompt.initialPrompt.trim().length > 0
      ? runnerConfig.prompt.initialPrompt
      : DEFAULT_EXECUTION_KICKOFF_PROMPT;

  const { unsubscribe, finished } = subscribeForCompletion(session, client, {
    stepId: request.stepId,
    sessionId: envConfig.sessionId,
  });

  if (request.background === true) {
    void runAgentBackground(
      session,
      client,
      kickoffPrompt,
      finished,
      request.stepId,
      checkpointWriter,
      unsubscribe,
    );
    return { ok: true, response: "" };
  }

  return runAgentForeground(
    session,
    client,
    kickoffPrompt,
    finished,
    request.stepId,
    checkpointWriter,
    unsubscribe,
  );
}
