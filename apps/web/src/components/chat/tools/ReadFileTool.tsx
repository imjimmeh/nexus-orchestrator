import { ToolCallHeader } from "./ToolCallHeader";
import type { ToolProps } from "./registry";
import { isRecord } from "./type-guards";
import { extractToolResultText } from "./tool-result-content";

const MAX_CHARS = 8000;

function pathFromArgs(args: unknown): { path: string; range?: string } {
  if (!isRecord(args)) return { path: "<unknown>" };
  const path = typeof args.path === "string" ? args.path : "<unknown>";
  const offset = typeof args.offset === "number" ? args.offset : undefined;
  const limit = typeof args.limit === "number" ? args.limit : undefined;
  if (typeof offset === "number" && typeof limit === "number") {
    return { path, range: `${offset}-${offset + limit - 1}` };
  }
  return { path };
}

export function ReadFileTool({ toolCall }: Readonly<ToolProps>) {
  const { path, range } = pathFromArgs(toolCall.argsObj);
  const full = extractToolResultText(toolCall.resultObj);
  const truncated = full.length > MAX_CHARS;
  const body = truncated ? full.slice(0, MAX_CHARS) : full;
  const label = range ? `${path}:${range}` : path;

  return (
    <div className="space-y-2">
      <ToolCallHeader
        glyph="📄"
        label={label}
        status={toolCall.status}
        isError={toolCall.isError}
        durationMs={toolCall.durationMs}
      />
      <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-foreground">
        {body}
      </pre>
      {truncated && (
        <span className="text-[10px] text-muted-foreground">
          truncated ({full.length} chars)
        </span>
      )}
    </div>
  );
}
