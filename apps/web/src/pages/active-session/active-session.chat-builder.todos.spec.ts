import { describe, expect, it } from "vitest";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";
import { getTodoItems } from "./active-session.chat-builder.todos";

function makeEvent(
  event_type: string,
  payload: Record<string, unknown> = {},
): WorkflowTelemetryEvent {
  return {
    event_type,
    payload,
    timestamp: new Date().toISOString(),
  } as WorkflowTelemetryEvent;
}

function makeTodoStateEvent(todos: unknown[]) {
  return makeEvent("todo_state_updated", { todos });
}

describe("getTodoItems", () => {
  it("returns empty array when no events", () => {
    expect(getTodoItems([])).toEqual([]);
  });

  it("returns todos from the latest todo_state_updated event", () => {
    const events = [
      makeTodoStateEvent([{ id: 1, text: "Task A", status: "not-started" }]),
    ];

    const result = getTodoItems(events);

    expect(result).toHaveLength(1);
    expect(result[0].text).toBe("Task A");
  });

  it("uses only the latest todo_state_updated payload", () => {
    const events = [
      makeTodoStateEvent([{ id: 1, text: "Task A", status: "not-started" }]),
      makeTodoStateEvent([
        { id: 1, text: "Task A", status: "in-progress" },
        { id: 2, text: "Task B", status: "not-started" },
      ]),
    ];

    const result = getTodoItems(events);

    expect(result).toHaveLength(2);
    expect(result[0].status).toBe("in-progress");
  });

  it("clears todos on session_completed", () => {
    const events = [
      makeTodoStateEvent([{ id: 1, text: "Task A", status: "not-started" }]),
      makeEvent("session_completed"),
    ];

    expect(getTodoItems(events)).toEqual([]);
  });

  it("clears todos on session_failed", () => {
    const events = [
      makeTodoStateEvent([{ id: 1, text: "Task A", status: "not-started" }]),
      makeEvent("session_failed"),
    ];

    expect(getTodoItems(events)).toEqual([]);
  });

  it("clears todos on session_cancelled", () => {
    const events = [
      makeTodoStateEvent([{ id: 1, text: "Task A", status: "not-started" }]),
      makeEvent("session_cancelled"),
    ];

    expect(getTodoItems(events)).toEqual([]);
  });

  it("clears todos on step_complete", () => {
    const events = [
      makeTodoStateEvent([{ id: 1, text: "Task A", status: "in-progress" }]),
      makeEvent("step_complete"),
    ];

    expect(getTodoItems(events)).toEqual([]);
  });

  it("ignores todo_state_updated events with invalid payload", () => {
    const events = [makeEvent("todo_state_updated", { todos: "not-an-array" })];

    expect(getTodoItems(events)).toEqual([]);
  });
});
