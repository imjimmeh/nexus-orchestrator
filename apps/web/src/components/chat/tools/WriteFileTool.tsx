import { useState } from "react";
import { ToolCallHeader } from "./ToolCallHeader";
import type { ToolProps } from "./registry";
import { isRecord } from "./type-guards";

const MAX_CHARS = 8000;

export function WriteFileTool({ toolCall }: Readonly<ToolProps>) {
  const [expanded, setExpanded] = useState(false);
  const args = toolCall.argsObj;
  const path =
    isRecord(args) && typeof args.path === "string" ? args.path : "<unknown>";
  const content =
    isRecord(args) && typeof args.content === "string" ? args.content : "";
  const truncated = content.length > MAX_CHARS;
  const visible =
    truncated && !expanded ? content.slice(0, MAX_CHARS) : content;

  return (
    <div className="space-y-2">
      <ToolCallHeader
        glyph="🗑️"
        label={path}
        status={toolCall.status}
        isError={toolCall.isError}
        durationMs={toolCall.durationMs}
      />
      <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-foreground">
        {visible}
      </pre>
      {truncated && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="text-[10px] text-muted-foreground underline"
        >
          {expanded ? "hide full file" : "show full file"}
        </button>
      )}
    </div>
  );
}
