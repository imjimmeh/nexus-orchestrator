import type { TodoItem } from "@nexus/core";
import { WorkflowTelemetryEvent } from "@/lib/api/workflows.types";

const TERMINAL_EVENTS = new Set([
  "session_completed",
  "session_failed",
  "session_cancelled",
  "step_complete",
]);

function parseTodos(payload: Record<string, unknown>): TodoItem[] | null {
  const raw = payload.todos;
  if (!Array.isArray(raw)) {
    return null;
  }

  const todos: TodoItem[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).id === "number" &&
      typeof (item as Record<string, unknown>).text === "string" &&
      typeof (item as Record<string, unknown>).status === "string"
    ) {
      todos.push(item as TodoItem);
    }
  }

  return todos;
}

export function getTodoItems(events: WorkflowTelemetryEvent[]): TodoItem[] {
  let current: TodoItem[] = [];

  for (const event of events) {
    if (TERMINAL_EVENTS.has(event.event_type)) {
      current = [];
      continue;
    }

    if (event.event_type === "todo_state_updated") {
      const todos = parseTodos(event.payload);
      if (todos !== null) {
        current = todos;
      }
    }
  }

  return current;
}
