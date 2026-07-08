import { useMemo } from "react";
import type { ToolProps } from "./registry";
import { isRecord } from "./type-guards";
import { extractToolResultText } from "./tool-result-content";

const MAX_ROWS = 200;

interface BashResult {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
}

function coalesceOutput(toolCall: ToolProps["toolCall"]): {
  stdout: string;
  stderr: string;
  exitCode: number | null;
} {
  const partials =
    toolCall.partialResults.length > 0
      ? toolCall.partialResults.map((p) => extractToolResultText(p)).join("")
      : "";
  const final = toolCall.resultObj;
  const record = isRecord(final) ? (final as BashResult) : {};
  const stdout =
    typeof record.stdout === "string"
      ? record.stdout
      : extractToolResultText(final);
  return {
    stdout: stdout + partials,
    stderr: typeof record.stderr === "string" ? record.stderr : "",
    exitCode: typeof record.exitCode === "number" ? record.exitCode : null,
  };
}

function exitTone(code: number | null): string {
  if (code === null) return "text-muted-foreground";
  if (code === 0) return "text-emerald-700 dark:text-emerald-300";
  return "text-red-700 dark:text-red-300";
}

function statusPillClass(isRunning: boolean, isError: boolean): string {
  if (isRunning) return "text-cyan-300 bg-cyan-900/50";
  if (isError) return "text-red-300 bg-red-900/50";
  return "text-emerald-300 bg-emerald-900/50";
}

function statusPillSymbol(isRunning: boolean, isError: boolean): string {
  if (isRunning) return "\u25CF";
  if (isError) return "\u2717";
  return "\u2713";
}

export function BashTool({ toolCall }: Readonly<ToolProps>) {
  const { stdout, stderr, exitCode } = useMemo(
    () => coalesceOutput(toolCall),
    [toolCall],
  );
  const rows = stdout.split("\n");
  const truncated = rows.length > MAX_ROWS;
  const visible = truncated ? rows.slice(0, MAX_ROWS).join("\n") : stdout;
  const isRunning =
    toolCall.status === "started" || toolCall.status === "updated";
  const command =
    isRecord(toolCall.argsObj) && typeof toolCall.argsObj.command === "string"
      ? toolCall.argsObj.command
      : "<unknown>";

  return (
    <div className="space-y-2 rounded border border-slate-700 bg-slate-900/60 px-3 py-2 font-mono text-xs text-slate-200">
      <div className="flex items-center justify-between gap-2 font-mono text-xs">
        <span className="truncate text-slate-200">$ {command}</span>
        <div className="flex shrink-0 items-center gap-2">
          {typeof toolCall.durationMs === "number" &&
            toolCall.status === "finished" && (
              <span className="text-[10px] text-slate-400">
                {toolCall.durationMs}ms
              </span>
            )}
          {!isRunning && exitCode !== null && (
            <span className={`text-[10px] ${exitTone(exitCode)}`}>
              exit: {exitCode}
            </span>
          )}
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${statusPillClass(isRunning, toolCall.isError)}`}
          >
            {statusPillSymbol(isRunning, toolCall.isError)}
          </span>
        </div>
      </div>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-slate-300">
        {visible}
      </pre>
      {truncated && (
        <span className="text-[10px] text-slate-400">
          truncated ({rows.length} rows)
        </span>
      )}
      {stderr && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-slate-700 text-red-300">
          {stderr}
        </pre>
      )}
    </div>
  );
}
