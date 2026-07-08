import { ToolCallHeader } from "./ToolCallHeader";
import type { ToolProps } from "./registry";
import { isRecord } from "./type-guards";
import { extractToolResultText } from "./tool-result-content";

const MAX_CHARS = 8000;
const PRIMARY_ARG_FIELDS = [
  "pattern",
  "query",
  "path",
  "dir",
  "directory",
  "command",
] as const;

function primaryArg(argsObj: unknown): string {
  if (!isRecord(argsObj)) return "";
  for (const field of PRIMARY_ARG_FIELDS) {
    const value = argsObj[field];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

/**
 * Compact renderer for listing / search style tools (ls, list_dir, grep, find):
 * a one-line header with the primary argument and the unwrapped text output.
 */
export function CommandResultTool({ toolCall }: Readonly<ToolProps>) {
  const arg = primaryArg(toolCall.argsObj);
  const label = arg ? `${toolCall.toolName} ${arg}` : toolCall.toolName;
  const full = extractToolResultText(toolCall.resultObj);
  const truncated = full.length > MAX_CHARS;
  const body = truncated ? full.slice(0, MAX_CHARS) : full;

  return (
    <div className="space-y-2">
      <ToolCallHeader
        glyph="❯"
        label={label}
        status={toolCall.status}
        isError={toolCall.isError}
        durationMs={toolCall.durationMs}
      />
      {body.length > 0 && (
        <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-foreground">
          {body}
        </pre>
      )}
      {truncated && (
        <span className="text-[10px] text-muted-foreground">
          truncated ({full.length} chars)
        </span>
      )}
    </div>
  );
}
