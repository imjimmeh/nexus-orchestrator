/**
 * HarnessSession implementation backed by a pi-coding-agent AgentSession.
 *
 * Subscribes to the SDK's raw event stream, maps each event to a
 * CanonicalSessionEvent, and forwards only recognised events to the caller.
 *
 * Response accumulation:
 * The SDK streams text via `message_update` events whose nested
 * `assistantMessageEvent` has type `"text_end"` and carries the full content
 * of a completed text block in `content`. We accumulate these blocks so that
 * when `turn_end` fires we use the accumulated text rather than relying on
 * `turn_end.message.text`, which is not a documented field on the real
 * `AssistantMessage` shape. This mirrors the behaviour in
 * `packages/pi-runner/src/telemetry/telemetry-bridge.ts`.
 */

import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { HarnessSession } from "@nexus/harness-runtime";
import type { CanonicalSessionEvent } from "@nexus/core";
import { mapPiEventToCanonical } from "./map-pi-event.js";

type RawEvent = Record<string, unknown>;

/**
 * Returns the accumulated text content from a `message_update` event when its
 * nested `assistantMessageEvent` signals a completed text block (`text_end`).
 * Returns `undefined` for all other event shapes.
 */
function extractTextEndContent(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const event = raw as RawEvent;
  if (event.type !== "message_update") return undefined;

  const assistantMessageEvent = event.assistantMessageEvent;
  if (!assistantMessageEvent || typeof assistantMessageEvent !== "object") {
    return undefined;
  }

  const msgEvent = assistantMessageEvent as RawEvent;
  if (msgEvent.type !== "text_end") return undefined;

  return typeof msgEvent.content === "string" ? msgEvent.content : undefined;
}

/**
 * Returns the full thinking content from a `message_update` event when its
 * nested `assistantMessageEvent` signals a completed thinking block
 * (`thinking_end`). Returns `undefined` for all other event shapes.
 *
 * Unlike text, thinking is surfaced as its own `agent_telemetry` event rather
 * than accumulated into the turn response, so the web session view can render
 * it as a collapsed "Thought" block without polluting the agent's answer.
 */
function extractThinkingEndContent(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;

  const event = raw as RawEvent;
  if (event.type !== "message_update") return undefined;

  const assistantMessageEvent = event.assistantMessageEvent;
  if (!assistantMessageEvent || typeof assistantMessageEvent !== "object") {
    return undefined;
  }

  const msgEvent = assistantMessageEvent as RawEvent;
  if (msgEvent.type !== "thinking_end") return undefined;

  return typeof msgEvent.content === "string" ? msgEvent.content : undefined;
}

export class PiHarnessSession implements HarnessSession {
  /** Accumulates text block content from `message_update / text_end` events. */
  private accumulatedResponse = "";

  /** Set by {@link suspend} when the turn is durably suspended (await). */
  private suspended = false;

  /** Guards against emitting more than one synthetic suspended end. */
  private suspendEnded = false;

  constructor(
    private readonly agentSession: AgentSession,
    private readonly stepId: string,
    private readonly sanitizedToOriginal: Map<string, string> = new Map(),
    /**
     * Optional teardown for engine-side resources tied to this session (e.g.
     * bridged MCP clients connected for contributed extensions). Invoked on
     * {@link dispose}; failures are swallowed so cleanup is best-effort.
     */
    private readonly onDispose?: () => Promise<void>,
  ) {}

  subscribe(onEvent: (event: CanonicalSessionEvent) => void): () => void {
    return this.agentSession.subscribe((raw: unknown) => {
      // Intercept text_end sub-events to build the accumulated response that
      // will be used when turn_end fires. These produce no canonical event of
      // their own (mapPiEventToCanonical returns null for message_update).
      const textContent = extractTextEndContent(raw);
      if (textContent !== undefined) {
        this.accumulatedResponse += textContent;
        return;
      }

      // Surface a completed thinking block as a standalone agent_telemetry
      // event so the session view can render it. This never feeds the response
      // accumulator, keeping reasoning separate from the agent's answer.
      const thinkingContent = extractThinkingEndContent(raw);
      if (thinkingContent !== undefined) {
        onEvent({
          type: "agent_telemetry",
          stepId: this.stepId,
          telemetryType: "thinking_end",
          content: thinkingContent,
        });
        return;
      }

      const mapped = mapPiEventToCanonical(
        raw,
        this.stepId,
        this.sanitizedToOriginal,
      );
      if (!mapped) return;

      if (this.suspended) {
        // A deliberate durable-await suspend is in progress: the engine aborted
        // the in-flight pi turn after a tool returned executionStatus:suspended.
        // Swallow the aborted turn_end (it would otherwise be reconciled as a
        // failed final turn and mask the suspend) and convert the terminal
        // agent_end into a clean suspended end so the runtime server parks the
        // run for durable resume instead of failing/retrying it. See kanban-atuq.
        if (mapped.type === "turn_end") return;
        if (mapped.type === "agent_end") {
          if (this.suspendEnded) return;
          this.suspendEnded = true;
          onEvent(this.buildSuspendedEnd());
          return;
        }
        // Non-terminal events (e.g. the await tool's tool_execution_end) still
        // flow through for telemetry.
      }

      if (mapped.type === "turn_end") {
        // Prefer accumulated streaming text; fall back to whatever the pure
        // mapper extracted from message.text (covers non-streaming scenarios).
        const response =
          this.accumulatedResponse !== ""
            ? this.accumulatedResponse
            : mapped.output.response;
        this.accumulatedResponse = "";
        onEvent({ ...mapped, output: { ...mapped.output, response } });
      } else {
        onEvent(mapped);
      }
    });
  }

  async prompt(message: string): Promise<void> {
    await this.agentSession.prompt(message);
  }

  /**
   * Marks this turn as deliberately suspended (durable agent-await). The engine
   * calls this from a tool's onTerminate hook, then aborts the in-flight pi run;
   * the subscribe handler then emits a clean suspended `agent_end` instead of an
   * aborted/error end. See kanban-atuq.
   */
  suspend(): void {
    this.suspended = true;
  }

  /** Builds the synthetic suspended agent_end forwarded to the runtime server. */
  private buildSuspendedEnd(): CanonicalSessionEvent {
    return {
      type: "agent_end",
      stepId: this.stepId,
      output: {
        ok: true,
        response: "Turn suspended pending awaited workflow completion.",
        stopReason: "suspended",
        suspended: true,
      },
    };
  }

  async abort(): Promise<void> {
    // The pi-coding-agent SDK does not expose a discrete abort method;
    // no-op here preserves the HarnessSession contract.
  }

  async dispose(): Promise<void> {
    this.agentSession.dispose();
    if (this.onDispose) {
      await this.onDispose().catch(() => undefined);
    }
  }
}
