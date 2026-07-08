/**
 * Todo Tracker Extension
 *
 * Displays a persistent todo widget showing task progress.
 * The agent creates todos before working on complex tasks,
 * and updates them as work progresses.
 *
 * Commands:
 *   /todos - Toggle todo list visibility
 *
 * Tool:
 *   todo - LLM tool to manage todos (add/start/complete/list/clear)
 */

import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { StringEnum } from "@mariozechner/pi-ai";
import { Text } from "@mariozechner/pi-tui";

// =============================================================================
// Types
// =============================================================================

interface Todo {
  id: number;
  text: string;
  status: "pending" | "in-progress" | "completed";
}

interface TodoState {
  todos: Todo[];
  nextId: number;
  visible: boolean;
  currentCtx: ExtensionContext | null;
}

// =============================================================================
// State
// =============================================================================

const state: TodoState = {
  todos: [],
  nextId: 1,
  visible: true,
  currentCtx: null,
};

// =============================================================================
// Widget Rendering
// =============================================================================

function renderTodo(todo: Todo, theme: Theme): string {
  switch (todo.status) {
    case "pending":
      return `☐ ${todo.text}`;
    case "in-progress":
      return theme.fg("accent", `◉ ${todo.text}`);
    case "completed":
      return theme.fg("dim", `☑ ${todo.text}`);
  }
}

function renderWidget(theme: Theme): string[] {
  if (state.todos.length === 0) {
    return [];
  }

  const lines: string[] = [];

  // Header with progress
  const completed = state.todos.filter((t) => t.status === "completed").length;
  const total = state.todos.length;
  const progress = `(${completed}/${total})`;
  const header =
    theme.fg("dim", `Tasks ${progress}`) + theme.fg("dim", " · /todos to hide");
  lines.push(header);

  // Todo items - show pending/in-progress first, then completed
  const pending = state.todos.filter((t) => t.status !== "completed");
  const done = state.todos.filter((t) => t.status === "completed");

  for (const todo of pending) {
    lines.push(renderTodo(todo, theme));
  }
  for (const todo of done) {
    lines.push(renderTodo(todo, theme));
  }

  lines.push(""); // Empty line for spacing

  return lines;
}

function updateWidget(ctx: ExtensionContext): void {
  if (!ctx.hasUI || !state.visible || state.todos.length === 0) {
    ctx.ui.setWidget("todos", undefined);
    return;
  }

  const lines = renderWidget(ctx.ui.theme);
  ctx.ui.setWidget("todos", lines);
}

// =============================================================================
// Todo Operations
// =============================================================================

function addTodo(text: string): Todo {
  const todo: Todo = {
    id: state.nextId++,
    text,
    status: "pending",
  };
  state.todos.push(todo);
  return todo;
}

function startTodo(id: number): Todo | null {
  const todo = state.todos.find((t) => t.id === id);
  if (todo && todo.status === "pending") {
    todo.status = "in-progress";
    return todo;
  }
  return null;
}

function completeTodo(id: number): Todo | null {
  const todo = state.todos.find((t) => t.id === id);
  if (todo && todo.status !== "completed") {
    todo.status = "completed";
    return todo;
  }
  return null;
}

function clearTodos(): void {
  state.todos = [];
  state.nextId = 1;
}

function listTodos(): string {
  if (state.todos.length === 0) {
    return "No todos.";
  }

  const lines = state.todos.map((t) => {
    const icon =
      t.status === "completed" ? "☑" : t.status === "in-progress" ? "◉" : "☐";
    return `${t.id}. [${icon}] ${t.text}`;
  });

  return lines.join("\n");
}

// =============================================================================
// Extension
// =============================================================================

export default function todoTrackerExtension(pi: ExtensionAPI): void {
  // -------------------------------------------------------------------------
  // Session Events - Restore state from session
  // -------------------------------------------------------------------------

  pi.on("session_start", async (_event, ctx) => {
    state.currentCtx = ctx;
    state.todos = [];
    state.nextId = 1;

    // Restore from session entries
    for (const entry of ctx.sessionManager.getBranch()) {
      if (entry.type === "custom" && entry.customType === "todos") {
        const data = entry.data as { todos: Todo[]; nextId: number };
        state.todos = data.todos;
        state.nextId = data.nextId;
      }
    }

    updateWidget(ctx);
  });

  // -------------------------------------------------------------------------
  // Before Agent Start - Inject soft guidance
  // -------------------------------------------------------------------------

  pi.on("before_agent_start", async (event, ctx) => {
    state.currentCtx = ctx;

    const guidance = `
For non-trivial tasks with multiple steps, use the \`todo\` tool to:
1. Create a task list before starting work
2. Mark tasks in-progress when beginning each one
3. Mark tasks complete when finished
Skip todos for simple questions or single-step tasks.
Do NOT create todos when there are fewer than 3 tasks — just do the work directly.`;

    return {
      systemPrompt: event.systemPrompt + "\n" + guidance,
    };
  });

  // -------------------------------------------------------------------------
  // Agent Events - Update context reference
  // -------------------------------------------------------------------------

  pi.on("agent_start", async (_event, ctx) => {
    state.currentCtx = ctx;
  });

  pi.on("turn_start", async (_event, ctx) => {
    state.currentCtx = ctx;
    ctx.ui.setWorkingMessage();
    updateWidget(ctx);
  });

  pi.on("turn_end", async (_event, ctx) => {
    state.currentCtx = ctx;
    updateWidget(ctx);
  });

  pi.on("agent_end", async (_event, ctx) => {
    state.currentCtx = ctx;
    const allCompleted =
      state.todos.length > 0 &&
      state.todos.every((t) => t.status === "completed");
    if (!allCompleted) return;

    // Brief pause so the user can see all tasks completed before the widget clears
    await new Promise((resolve) => setTimeout(resolve, 1500));

    clearTodos();
    updateWidget(ctx);
    pi.appendEntry("todos", {
      todos: state.todos,
      nextId: state.nextId,
    });
  });

  // -------------------------------------------------------------------------
  // Todo Tool
  // -------------------------------------------------------------------------

  pi.registerTool({
    name: "todo",
    label: "Todo",
    description:
      "Manage a todo list for tracking task progress. Use for complex multi-step tasks. Actions: add (create todo), start (mark in-progress), complete (mark done), list (show all), clear (remove all).",
    parameters: Type.Object({
      action: StringEnum(
        ["add", "start", "complete", "list", "clear"] as const,
        {
          description: "Action to perform",
        },
      ),
      text: Type.Optional(
        Type.String({
          description: "Todo text (required for 'add' action)",
        }),
      ),
      id: Type.Optional(
        Type.Number({
          description: "Todo ID (required for 'start' and 'complete' actions)",
        }),
      ),
    }),

    async execute(toolCallId, params, signal, onUpdate, ctx) {
      state.currentCtx = ctx;
      let result: string;

      switch (params.action) {
        case "add": {
          if (!params.text) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: 'text' is required for add action",
                },
              ],
              isError: true,
            };
          }
          const todo = addTodo(params.text);
          result = `Added todo #${todo.id}: ${todo.text}`;
          break;
        }

        case "start": {
          if (params.id === undefined) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: 'id' is required for start action",
                },
              ],
              isError: true,
            };
          }
          const todo = startTodo(params.id);
          if (todo) {
            result = `Started todo #${todo.id}: ${todo.text}`;
            // Update working message
            ctx.ui.setWorkingMessage(`Working on: ${todo.text}`);
          } else {
            result = `Todo #${params.id} not found or already in progress/completed`;
          }
          break;
        }

        case "complete": {
          if (params.id === undefined) {
            return {
              content: [
                {
                  type: "text",
                  text: "Error: 'id' is required for complete action",
                },
              ],
              isError: true,
            };
          }
          const todo = completeTodo(params.id);
          if (todo) {
            result = `Completed todo #${todo.id}: ${todo.text}`;
            // Clear working message if no more in-progress
            const inProgress = state.todos.find(
              (t) => t.status === "in-progress",
            );
            if (!inProgress) {
              ctx.ui.setWorkingMessage();
            }
          } else {
            result = `Todo #${params.id} not found or already completed`;
          }
          break;
        }

        case "list": {
          result = listTodos();
          break;
        }

        case "clear": {
          clearTodos();
          result = "All todos cleared";
          ctx.ui.setWorkingMessage();
          break;
        }

        default:
          result = `Unknown action: ${params.action}`;
      }

      // Update widget
      updateWidget(ctx);

      // Persist to session
      pi.appendEntry("todos", {
        todos: state.todos,
        nextId: state.nextId,
      });

      return {
        content: [{ type: "text", text: result }],
        details: {
          todos: state.todos,
          nextId: state.nextId,
        },
      };
    },

    // Hidden rendering — the persistent widget already shows todo state
    renderCall(_args, _theme) {
      return new Text("", 0, 0);
    },

    renderResult(_result, _options, _theme) {
      return new Text("", 0, 0);
    },
  });

  // -------------------------------------------------------------------------
  // /todos Command - Toggle visibility
  // -------------------------------------------------------------------------

  pi.registerCommand("todos", {
    description: "Toggle todo list visibility",
    handler: async (_args, ctx) => {
      state.visible = !state.visible;
      state.currentCtx = ctx;

      if (state.visible) {
        ctx.ui.notify("Todo list visible", "info");
      } else {
        ctx.ui.notify("Todo list hidden", "info");
      }

      updateWidget(ctx);
    },
  });

  // -------------------------------------------------------------------------
  // /todos clear Command - Clear all todos
  // -------------------------------------------------------------------------

  pi.registerCommand("todos-clear", {
    description: "Clear all todos",
    handler: async (_args, ctx) => {
      clearTodos();
      state.currentCtx = ctx;
      updateWidget(ctx);
      ctx.ui.notify("All todos cleared", "info");

      // Persist
      pi.appendEntry("todos", {
        todos: state.todos,
        nextId: state.nextId,
      });
    },
  });
}
