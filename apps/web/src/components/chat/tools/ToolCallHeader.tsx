import { cn } from "@/lib/utils";
import { ToolCallStatusPill } from "./ToolCallStatusPill";

export interface ToolCallHeaderProps {
  glyph: string;
  label: string;
  status: "started" | "updated" | "finished";
  isError: boolean;
  durationMs?: number;
  className?: string;
}

export function ToolCallHeader({
  glyph,
  label,
  status,
  isError,
  durationMs,
  className,
}: Readonly<ToolCallHeaderProps>) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <div className="flex min-w-0 items-center gap-2 font-mono text-xs">
        <span aria-hidden className="shrink-0 text-muted-foreground">
          {glyph}
        </span>
        <span className="truncate text-foreground">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {typeof durationMs === "number" && status === "finished" && (
          <span className="text-[10px] text-muted-foreground">
            {durationMs}ms
          </span>
        )}
        <ToolCallStatusPill status={status} isError={isError} />
      </div>
    </div>
  );
}
