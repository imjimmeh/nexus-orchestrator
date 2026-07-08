import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export interface AttachmentChipProps {
  filename: string;
  parseStatus: string;
  onRemove?: () => void;
  className?: string;
}

const PARSE_STATUS_CLASSES: Record<string, string> = {
  parsed: "bg-success/20 text-success",
  parsing: "bg-info/20 text-info",
  pending: "bg-warning/20 text-warning",
  failed: "bg-destructive/20 text-destructive",
  skipped: "bg-muted text-muted-foreground",
};

const PARSE_STATUS_LABELS: Record<string, string> = {
  parsed: "Parsed",
  parsing: "Parsing…",
  pending: "Pending",
  failed: "Failed",
  skipped: "Skipped",
};

function resolveStatusClass(status: string): string {
  return PARSE_STATUS_CLASSES[status] ?? "bg-muted text-muted-foreground";
}

function resolveStatusLabel(status: string): string {
  return PARSE_STATUS_LABELS[status] ?? status;
}

export function AttachmentChip({
  filename,
  parseStatus,
  onRemove,
  className,
}: AttachmentChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs font-medium",
        className,
      )}
    >
      <span
        className={cn(
          "rounded px-1 py-0.5 text-[10px] font-semibold",
          resolveStatusClass(parseStatus),
        )}
        aria-label={`Parse status: ${resolveStatusLabel(parseStatus)}`}
      >
        {resolveStatusLabel(parseStatus)}
      </span>

      <span className="max-w-[180px] truncate text-foreground" title={filename}>
        {filename}
      </span>

      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="ml-0.5 h-5 w-5 rounded hover:text-destructive focus:ring-1 focus:ring-ring"
          aria-label={`Remove ${filename}`}
          onClick={onRemove}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
    </span>
  );
}
