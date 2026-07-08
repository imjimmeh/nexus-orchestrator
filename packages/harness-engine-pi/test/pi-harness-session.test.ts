/**
 * Unit tests for PiHarnessSession response-accumulation behaviour.
 *
 * Verifies that text content streamed via `message_update / text_end` events
 * is accumulated and used as the `turn_end` response rather than relying on the
 * non-standard `turn_end.message.text` field.
 */

import { describe, it, expect, vi } from "vitest";
import type { CanonicalSessionEvent } from "@nexus/core";
import { PiHarnessSession } from "../src/pi-harness-session.js";

// ---------------------------------------------------------------------------
// Minimal fake AgentSession that captures the subscriber and lets tests emit.
// ---------------------------------------------------------------------------

type EventListener = (event: Record<string, unknown>) => void;

function createFakeAgentSession() {
  let listener: EventListener | null = null;

  return {
    subscribe(fn: EventListener): () => void {
      listener = fn;
      return vi.fn(() => {
        listener = null;
      });
    },
    emit(event: Record<string, unknown>): void {
      listener?.(event);
    },
    prompt: vi.fn(),
    dispose: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Helpers to build SDK event shapes
// ---------------------------------------------------------------------------

function messageUpdateTextEnd(content: string): Record<string, unknown> {
  return {
    type: "message_update",
    assistantMessageEvent: {
      type: "text_end",
      contentIndex: 0,
      content,
    },
  };
}

function messageUpdateThinkingEnd(content: string): Record<string, unknown> {
  return {
    type: "message_update",
    assistantMessageEvent: {
      type: "thinking_end",
      contentIndex: 0,
      content,
    },
  };
}

function turnEndEvent(stopReason = "end_turn"): Record<string, unknown> {
  // Real SDK shape: message is an AssistantMessage with no top-level `text`.
  return {
    type: "turn_end",
    message: { stopReason, usage: undefined },
    toolResults: [],
  };
}

function agentEndEvent(stopReason = "end_turn"): Record<string, unknown> {
  return {
    type: "agent_end",
    messages: [],
    message: { stopReason },
    willRetry: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PiHarnessSession", () => {
  describe("text accumulation", () => {
    it("uses accumulated text_end content as turn_end response when available", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(fakeSession as never, "step-acc");

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      fakeSession.emit(messageUpdateTextEnd("Hello, "));
      fakeSession.emit(messageUpdateTextEnd("world!"));
      fakeSession.emit(turnEndEvent());

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "turn_end",
        stepId: "step-acc",
        output: { ok: true, response: "Hello, world!", stopReason: "end_turn" },
      });
    });

    it("does not emit a canonical event for message_update / text_end itself", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(fakeSession as never, "step-1");

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      fakeSession.emit(messageUpdateTextEnd("some text"));

      expect(events).toHaveLength(0);
    });

    it("resets the accumulator after each turn_end so subsequent turns start fresh", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(fakeSession as never, "step-reset");

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      // First turn
      fakeSession.emit(messageUpdateTextEnd("first turn text"));
      fakeSession.emit(turnEndEvent());

      // Second turn — no streaming text, relies on fallback
      fakeSession.emit(turnEndEvent());

      expect(events).toHaveLength(2);
      const firstTurnEnd = events[0];
      const secondTurnEnd = events[1];
      expect(firstTurnEnd).toMatchObject({
        type: "turn_end",
        output: { response: "first turn text" },
      });
      // No accumulated text; mapPiEventToCanonical falls back to message.text which is undefined → ""
      expect(secondTurnEnd).toMatchObject({
        type: "turn_end",
        output: { response: "" },
      });
    });

    it("falls back to message.text when no streaming deltas have been received", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(
        fakeSession as never,
        "step-fallback",
      );

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      // Emit a turn_end whose message carries a text property (non-streaming / test fixture shape).
      fakeSession.emit({
        type: "turn_end",
        message: {
          stopReason: "end_turn",
          text: "fallback text",
          usage: undefined,
        },
        toolResults: [],
      });

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "turn_end",
        output: { response: "fallback text" },
      });
    });

    it("ignores message_update events whose nested type is not text_end", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(fakeSession as never, "step-ignore");

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      // text_delta events should not accumulate
      fakeSession.emit({
        type: "message_update",
        assistantMessageEvent: {
          type: "text_delta",
          contentIndex: 0,
          delta: "ignored",
        },
      });

      fakeSession.emit(turnEndEvent());

      expect(events).toHaveLength(1);
      // No accumulation — response falls back to "" (no text on message)
      expect(events[0]).toMatchObject({
        type: "turn_end",
        output: { response: "" },
      });
    });
  });

  describe("thinking telemetry", () => {
    it("emits an agent_telemetry thinking_end event carrying the full thinking content", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(fakeSession as never, "step-think");

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      fakeSession.emit(messageUpdateThinkingEnd("Let me reason about this."));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "agent_telemetry",
        stepId: "step-think",
        telemetryType: "thinking_end",
        content: "Let me reason about this.",
      });
    });

    it("does not leak thinking content into the turn_end response", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(
        fakeSession as never,
        "step-think-2",
      );

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      fakeSession.emit(messageUpdateThinkingEnd("hidden reasoning"));
      fakeSession.emit(messageUpdateTextEnd("Visible answer."));
      fakeSession.emit(turnEndEvent());

      const turnEnd = events.find((e) => e.type === "turn_end");
      expect(turnEnd).toMatchObject({
        type: "turn_end",
        output: { response: "Visible answer." },
      });
    });
  });

  describe("durable-await suspend", () => {
    it("emits a clean suspended agent_end (ok:true) when suspended before the run ends", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(
        fakeSession as never,
        "step-suspend",
      );

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      session.suspend();
      fakeSession.emit(agentEndEvent("aborted"));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "agent_end",
        stepId: "step-suspend",
        output: { ok: true, stopReason: "suspended", suspended: true },
      });
    });

    it("suppresses the aborted turn_end after suspend so it cannot mask the suspended completion", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(
        fakeSession as never,
        "step-suspend-2",
      );

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      session.suspend();
      // The pi SDK aborts mid-turn: an aborted turn_end may precede agent_end.
      fakeSession.emit(turnEndEvent("aborted"));
      fakeSession.emit(agentEndEvent("aborted"));

      // Exactly one event — the synthetic suspended end. No ok:false turn_end
      // leaks through to the completion tracker.
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "agent_end",
        output: { ok: true, stopReason: "suspended", suspended: true },
      });
    });

    it("forwards a normal agent_end unchanged when not suspended", () => {
      const fakeSession = createFakeAgentSession();
      const session = new PiHarnessSession(fakeSession as never, "step-normal");

      const events: CanonicalSessionEvent[] = [];
      session.subscribe((e) => events.push(e));

      fakeSession.emit(agentEndEvent("end_turn"));

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "agent_end",
        output: { ok: true, stopReason: "end_turn" },
      });
      expect(
        (events[0] as { output?: { suspended?: boolean } }).output?.suspended,
      ).toBeUndefined();
    });
  });
});
