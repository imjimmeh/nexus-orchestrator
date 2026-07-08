import { ToolCallHeader } from "./ToolCallHeader";
import type { ToolProps } from "./registry";
import { computeUnifiedDiff, countDiff } from "./diff";
import { extractErrorText } from "./extract-error-text";
import { isRecord } from "./type-guards";

function getStr(args: unknown, field: string): string {
  return isRecord(args) && typeof args[field] === "string"
    ? (args[field] as string)
    : "";
}

/**
 * Resolve the before/after text from either the harness `edits[]` shape
 * (`[{ oldText, newText }]`) or the legacy `oldString`/`newString` fields,
 * concatenating multiple edits so the diff covers the whole change.
 */
function resolveEditText(args: unknown): { oldStr: string; newStr: string } {
  if (isRecord(args) && Array.isArray(args.edits)) {
    const edits = args.edits.filter(isRecord);
    return {
      oldStr: edits.map((e) => getStr(e, "oldText")).join("\n"),
      newStr: edits.map((e) => getStr(e, "newText")).join("\n"),
    };
  }
  return {
    oldStr: getStr(args, "oldString"),
    newStr: getStr(args, "newString"),
  };
}

export function EditFileTool({ toolCall }: Readonly<ToolProps>) {
  const args = toolCall.argsObj;
  const path =
    isRecord(args) && typeof args.path === "string" ? args.path : "<unknown>";
  const { oldStr, newStr } = resolveEditText(args);
  const replaceAll = isRecord(args) && args.replaceAll === true;
  const replacedCount =
    isRecord(toolCall.resultObj) &&
    typeof toolCall.resultObj.replaced === "number"
      ? toolCall.resultObj.replaced
      : undefined;

  const diff = computeUnifiedDiff(oldStr, newStr);
  const { added, removed } = countDiff(diff);
  const errorText = toolCall.isError
    ? (toolCall.errorText ?? extractErrorText(toolCall.resultObj))
    : undefined;

  return (
    <div className="space-y-2">
      <ToolCallHeader
        glyph="✏️"
        label={path}
        status={toolCall.status}
        isError={toolCall.isError}
        durationMs={toolCall.durationMs}
      />
      <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
        <span className="text-emerald-700 dark:text-emerald-300">+{added}</span>
        <span className="text-red-700 dark:text-red-300">-{removed}</span>
        {replaceAll && (
          <span className="rounded bg-amber-100/70 px-1 dark:bg-amber-900/50">
            replaceAll
            {typeof replacedCount === "number" ? ` (${replacedCount})` : ""}
          </span>
        )}
      </div>
      {errorText && (
        <p className="rounded border border-red-500/30 bg-red-50/70 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
          {errorText}
        </p>
      )}
      <pre className="overflow-x-auto whitespace-pre rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-foreground">
        {diff.map((line, idx) => (
          <span
            key={idx}
            className={
              line.type === "add"
                ? "block bg-emerald-100/60 dark:bg-emerald-950/30"
                : line.type === "del"
                  ? "block bg-red-100/60 dark:bg-red-950/30"
                  : "block"
            }
          >
            {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}{" "}
            {line.text}
          </span>
        ))}
      </pre>
    </div>
  );
}
