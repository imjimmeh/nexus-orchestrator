import { useEffect, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDot,
} from "lucide-react";
import type { TodoItem, TodoStatus } from "@nexus/core";

interface AgentTodoPanelProps {
  todos: TodoItem[];
}

function TodoIcon({ status }: { status: TodoStatus }) {
  switch (status) {
    case "in-progress":
      return <CircleDot className="h-4 w-4 shrink-0 text-primary" />;
    case "completed":
      return (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-muted-foreground" />
      );
    default:
      return <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />;
  }
}

function resolveSummaryLine(todos: TodoItem[]): string {
  const inProgress = todos.find((todo) => todo.status === "in-progress");
  if (inProgress) {
    return inProgress.text;
  }

  const completedCount = todos.filter(
    (todo) => todo.status === "completed",
  ).length;
  return `${String(completedCount)} of ${String(todos.length)} completed`;
}

export function AgentTodoPanel({ todos }: Readonly<AgentTodoPanelProps>) {
  const hasInProgress = todos.some((todo) => todo.status === "in-progress");
  const [open, setOpen] = useState(hasInProgress);

  useEffect(() => {
    if (hasInProgress) {
      setOpen(true);
    }
  }, [hasInProgress]);

  if (todos.length === 0) {
    return null;
  }

  return (
    <div className="rounded-md border bg-card">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
        onClick={() => setOpen((current) => !current)}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <span className="mr-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Tasks
        </span>
        <span className="truncate">{resolveSummaryLine(todos)}</span>
      </button>
      {open ? (
        <ul className="mt-1 space-y-1 px-3 pb-2">
          {todos.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 py-0.5">
              <TodoIcon status={todo.status} />
              <span
                className={
                  todo.status === "completed"
                    ? "text-sm text-muted-foreground line-through"
                    : "text-sm"
                }
              >
                {todo.text}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
