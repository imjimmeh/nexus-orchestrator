import { cn } from "@/lib/utils";

export interface ToolCallStatusPillProps {
  status: "started" | "updated" | "finished";
  isError: boolean;
  className?: string;
}

export function ToolCallStatusPill({
  status,
  isError,
  className,
}: Readonly<ToolCallStatusPillProps>) {
  const isRunning = status === "started" || status === "updated";
  const isFinishedError = status === "finished" && isError;
  const glyph = isRunning ? "●" : isFinishedError ? "✗" : "✓";
  const label = isRunning ? "running" : isFinishedError ? "failed" : "ok";
  const tone = isRunning
    ? "text-cyan-700 bg-cyan-100/70 dark:text-cyan-300 dark:bg-cyan-900/50"
    : isFinishedError
      ? "text-red-700 bg-red-100/70 dark:text-red-300 dark:bg-red-900/50"
      : "text-emerald-700 bg-emerald-100/70 dark:text-emerald-300 dark:bg-emerald-900/50";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono",
        tone,
        className,
      )}
    >
      <span aria-hidden>{glyph}</span>
      <span>{label}</span>
    </span>
  );
}
