import { ToolCallHeader } from "./ToolCallHeader";
import type { ToolProps } from "./registry";
import { extractErrorText } from "./extract-error-text";
import { normalizeToolResult } from "./tool-result-content";

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function GenericTool({ toolCall }: Readonly<ToolProps>) {
  const argsJson =
    toolCall.argsObj !== undefined ? prettyJson(toolCall.argsObj) : null;
  const normalizedResult = normalizeToolResult(toolCall.resultObj);
  const resultText =
    normalizedResult.kind === "text"
      ? normalizedResult.text
      : normalizedResult.kind === "json"
        ? prettyJson(normalizedResult.value)
        : null;
  const errorSource =
    normalizedResult.kind === "json"
      ? normalizedResult.value
      : toolCall.resultObj;
  const errorText = toolCall.isError
    ? (toolCall.errorText ?? extractErrorText(errorSource))
    : undefined;

  return (
    <div className="space-y-2">
      <ToolCallHeader
        glyph="•"
        label={toolCall.toolName}
        status={toolCall.status}
        isError={toolCall.isError}
        durationMs={toolCall.durationMs}
      />
      {argsJson !== null && (
        <section className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Args
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-foreground">
            {argsJson}
          </pre>
        </section>
      )}
      {!toolCall.isError && resultText !== null && (
        <section className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Result
          </p>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-foreground">
            {resultText}
          </pre>
        </section>
      )}
      {toolCall.isError && (
        <section className="space-y-1">
          <p className="text-[10px] uppercase tracking-wide text-red-700 dark:text-red-300">
            Error
          </p>
          {errorText && (
            <p className="rounded border border-red-500/30 bg-red-50/70 px-2 py-1 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-200">
              {errorText}
            </p>
          )}
          {resultText !== null && (
            <details className="mt-1">
              <summary className="cursor-pointer text-[10px] text-muted-foreground">
                Raw result
              </summary>
              <pre className="mt-1 overflow-x-auto whitespace-pre-wrap rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-foreground">
                {resultText}
              </pre>
            </details>
          )}
        </section>
      )}
    </div>
  );
}
