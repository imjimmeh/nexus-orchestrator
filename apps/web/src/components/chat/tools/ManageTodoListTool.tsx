import { ToolCallHeader } from "./ToolCallHeader";
import type { ToolProps } from "./registry";
import { isRecord } from "./type-guards";

interface TodoItem {
  content: string;
  status: string;
  priority?: string;
}

function glyphForStatus(status: string): string {
  if (status === "completed") return "✓";
  if (status === "in-progress" || status === "in_progress") return "●";
  if (status === "cancelled") return "✗";
  return "□";
}

function priorityClass(priority?: string): string {
  if (priority === "high")
    return "bg-red-100/70 text-red-700 dark:bg-red-900/50 dark:text-red-300";
  if (priority === "medium")
    return "bg-amber-100/70 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300";
  if (priority === "low")
    return "bg-slate-100/70 text-slate-700 dark:bg-slate-900/50 dark:text-slate-300";
  return "bg-muted";
}

/**
 * The Nexus `manage_todo_list` tool sends items under `todo_list` with a
 * `title` field; the harness-native todo tools use `todos` with `content`.
 * Accept both so the list renders regardless of which harness produced it.
 */
function extractTodos(argsObj: unknown): TodoItem[] {
  if (!isRecord(argsObj)) return [];
  const raw = Array.isArray(argsObj.todo_list)
    ? argsObj.todo_list
    : Array.isArray(argsObj.todos)
      ? argsObj.todos
      : [];
  return raw
    .map((entry): TodoItem | null => {
      if (!isRecord(entry)) return null;
      const content =
        typeof entry.title === "string"
          ? entry.title
          : typeof entry.content === "string"
            ? entry.content
            : null;
      if (content === null) return null;
      return {
        content,
        status: typeof entry.status === "string" ? entry.status : "not-started",
        priority:
          typeof entry.priority === "string" ? entry.priority : undefined,
      };
    })
    .filter((todo): todo is TodoItem => todo !== null);
}

export function ManageTodoListTool({ toolCall }: Readonly<ToolProps>) {
  const todos = extractTodos(toolCall.argsObj);

  return (
    <div className="space-y-2">
      <ToolCallHeader
        glyph="☑"
        label={`${todos.length} todos`}
        status={toolCall.status}
        isError={toolCall.isError}
        durationMs={toolCall.durationMs}
      />
      {todos.length === 0 ? (
        <p className="text-xs text-muted-foreground">no todos</p>
      ) : (
        <ul className="space-y-1">
          {todos.map((t, idx) => (
            <li key={idx} className="flex items-center gap-2 text-xs">
              <span aria-hidden>{glyphForStatus(t.status)}</span>
              <span className="flex-1 text-foreground">{t.content}</span>
              {t.priority && (
                <span
                  className={`rounded px-1 text-[10px] ${priorityClass(t.priority)}`}
                >
                  {t.priority}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
