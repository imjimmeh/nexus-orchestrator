import { ToolCallHeader } from "./ToolCallHeader";
import type { ToolProps } from "./registry";
import { extractErrorText } from "./extract-error-text";
import { normalizeToolResult } from "./tool-result-content";

const KANBAN_PREFIX = "kanban.";

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * Renderer for the Kanban tool family (`kanban.*`). Strips the namespace for a
 * readable label and shows the unwrapped result — Kanban tools return the
 * Anthropic content envelope wrapping JSON, which would otherwise be unreadable.
 */
export function KanbanTool({ toolCall }: Readonly<ToolProps>) {
  const method = toolCall.toolName.startsWith(KANBAN_PREFIX)
    ? toolCall.toolName.slice(KANBAN_PREFIX.length)
    : toolCall.toolName;
  const normalized = normalizeToolResult(toolCall.resultObj);
  const body =
    normalized.kind === "json"
      ? prettyJson(normalized.value)
      : normalized.kind === "text"
        ? normalized.text
        : "";
  const errorText = toolCall.isError
    ? (toolCall.errorText ?? extractErrorText(toolCall.resultObj))
    : undefined;

  return (
    <div className="space-y-2">
      <ToolCallHeader
        glyph="▤"
        label={`kanban · ${method}`}
        status={toolCall.status}
        isError={toolCall.isError}
        durationMs={toolCall.durationMs}
      />
      {errorText && (
        <p className="rounded border border-red-500/30 bg-red-50/70 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {errorText}
        </p>
      )}
      {!toolCall.isError && body.length > 0 && (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-foreground">
          {body}
        </pre>
      )}
    </div>
  );
}
