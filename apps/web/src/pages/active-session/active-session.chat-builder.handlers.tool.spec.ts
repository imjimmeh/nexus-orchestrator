import { describe, expect, it } from "vitest";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import type { SessionChatBuildState } from "./active-session.chat-builder.types";
import type { SessionChatMessage } from "./active-session.utils.types";
import { handleToolEvent } from "./active-session.chat-builder.handlers.tool";

function buildState(): SessionChatBuildState {
  return {
    messages: [],
    activeAgentStream: null,
    lastCompletedAgentStreamIndex: null,
    activeThoughtStream: null,
    activeToolMessageByKey: new Map(),
    activeSubagentMessageByKey: new Map(),
    activeCommandMessageByKey: new Map(),
    commandEventsByStepId: new Map(),
  };
}

function buildEvent(
  eventType: WorkflowTelemetryEvent["event_type"],
  payload: Record<string, unknown>,
  timestamp = "2026-06-23T00:00:00Z",
): WorkflowTelemetryEvent {
  return {
    event_type: eventType,
    timestamp,
    payload,
  } as unknown as WorkflowTelemetryEvent;
}

describe("handleToolEvent tool_call metadata", () => {
  it("creates a tool message with metadata.type=tool_call on start", () => {
    const state = buildState();
    handleToolEvent(
      state,
      buildEvent("tool_execution_start", {
        toolName: "bash",
        toolCallId: "c1",
        args: { command: "ls" },
      }),
      "m1",
    );
    const msg = state.messages[0] as SessionChatMessage;
    expect(msg.metadata?.type).toBe("tool_call");
    expect(msg.metadata).toMatchObject({
      toolName: "bash",
      callId: "c1",
      status: "started",
      argsObj: { command: "ls" },
      partialResults: [],
      isError: false,
    });
    expect((msg.metadata as { summary: string }).summary).toBe("$ ls · ●");
    expect(msg.collapsedByDefault).toBe(true);
  });

  it("appends partialResults on update", () => {
    const state = buildState();
    handleToolEvent(
      state,
      buildEvent("tool_execution_start", {
        toolName: "bash",
        toolCallId: "c1",
        args: { command: "ls" },
      }),
      "m1",
    );
    handleToolEvent(
      state,
      buildEvent("tool_execution_update", {
        toolCallId: "c1",
        partialResult: "file1",
      }),
      "m1",
    );
    handleToolEvent(
      state,
      buildEvent("tool_execution_update", {
        toolCallId: "c1",
        partialResult: "file2",
      }),
      "m1",
    );
    const msg = state.messages[0] as SessionChatMessage;
    expect(
      (msg.metadata as { partialResults: unknown[] }).partialResults,
    ).toEqual(["file1", "file2"]);
    expect((msg.metadata as { status: string }).status).toBe("updated");
  });

  it("finalizes on end with resultObj, durationMs, and collapses by default false", () => {
    const state = buildState();
    handleToolEvent(
      state,
      buildEvent("tool_execution_start", {
        toolName: "bash",
        toolCallId: "c1",
        args: { command: "ls" },
      }),
      "m1",
    );
    handleToolEvent(
      state,
      buildEvent("tool_execution_end", {
        toolCallId: "c1",
        result: "file1\n",
        isError: false,
      }),
      "m1",
    );
    const msg = state.messages[0] as SessionChatMessage;
    expect((msg.metadata as { status: string }).status).toBe("finished");
    expect((msg.metadata as { resultObj: unknown }).resultObj).toBe("file1\n");
    expect((msg.metadata as { isError: boolean }).isError).toBe(false);
    expect((msg.metadata as { endedAt?: number }).endedAt).toBeTypeOf("number");
    expect((msg.metadata as { durationMs?: number }).durationMs).toBeTypeOf(
      "number",
    );
    expect(msg.collapsedByDefault).toBe(false);
  });

  it("extracts errorText when isError end", () => {
    const state = buildState();
    handleToolEvent(
      state,
      buildEvent("tool_execution_start", {
        toolName: "bash",
        toolCallId: "c1",
        args: { command: "ls" },
      }),
      "m1",
    );
    handleToolEvent(
      state,
      buildEvent("tool_execution_end", {
        toolCallId: "c1",
        result: { message: "boom" },
        isError: true,
      }),
      "m1",
    );
    const msg = state.messages[0] as SessionChatMessage;
    expect((msg.metadata as { isError: boolean }).isError).toBe(true);
    expect((msg.metadata as { errorText?: string }).errorText).toBe("boom");
  });

  it("does not build detailsContent for tool_call messages", () => {
    const state = buildState();
    handleToolEvent(
      state,
      buildEvent("tool_execution_start", {
        toolName: "bash",
        toolCallId: "c1",
        args: { command: "ls" },
      }),
      "m1",
    );
    const msg = state.messages[0] as SessionChatMessage;
    expect(msg.detailsContent).toBeUndefined();
  });
});
