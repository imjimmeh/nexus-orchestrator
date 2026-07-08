import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";
import { ToolCallHeader } from "./ToolCallHeader";
import type { ToolProps } from "./registry";
import { isRecord } from "./type-guards";

function delegateLabel(toolName: string): string {
  const suffix = toolName.startsWith("delegate_")
    ? toolName.slice("delegate_".length)
    : toolName;
  return suffix
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function extractTask(args: unknown): string {
  if (!isRecord(args)) return "";
  for (const f of ["task", "goal"]) {
    if (typeof args[f] === "string") return args[f] as string;
  }
  return "";
}

function extractChatSessionId(result: unknown): string | null {
  if (isRecord(result)) {
    for (const f of [
      "chatSessionId",
      "chat_session_id",
      "sessionId",
      "session_id",
    ]) {
      if (typeof result[f] === "string") return result[f] as string;
    }
  }
  return null;
}

export function DelegateTool({ toolCall }: Readonly<ToolProps>) {
  const label = delegateLabel(toolCall.toolName);
  const task = extractTask(toolCall.argsObj);
  const chatSessionId = extractChatSessionId(toolCall.resultObj);

  return (
    <div className="space-y-2 rounded-md border border-cyan-500/20 bg-cyan-50/30 p-3 dark:bg-cyan-950/20">
      <ToolCallHeader
        glyph="🤝"
        label={`delegate ${label}`}
        status={toolCall.status}
        isError={toolCall.isError}
        durationMs={toolCall.durationMs}
      />
      <Badge
        variant="secondary"
        className="text-[10px] uppercase tracking-wider"
      >
        {label}
      </Badge>
      {task && (
        <p className="line-clamp-3 text-xs italic text-muted-foreground">
          "{task}"
        </p>
      )}
      {toolCall.isError && toolCall.errorText && (
        <p className="rounded border border-red-500/30 bg-red-50/70 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {toolCall.errorText}
        </p>
      )}
      {chatSessionId && (
        <Link
          to={`/sessions/${chatSessionId}`}
          className="inline-flex items-center gap-1 text-[11px] text-cyan-700 underline dark:text-cyan-300"
        >
          Open delegate session <ExternalLink className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
