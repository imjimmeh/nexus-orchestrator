import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Status =
  | "info"
  | "running"
  | "pending"
  | "success"
  | "completed"
  | "failed"
  | "error"
  | "cancelled"
  | "skipped"
  | "warning";

interface StatusBadgeProps {
  status: string;
  pulse?: boolean;
  className?: string;
}

const STATUS_VARIANTS: Record<
  Status,
  "info" | "warning" | "success" | "error" | "secondary"
> = {
  info: "info",
  running: "warning",
  pending: "warning",
  success: "success",
  completed: "success",
  failed: "error",
  error: "error",
  cancelled: "secondary",
  skipped: "secondary",
  warning: "warning",
};

const STATUS_LABELS: Record<Status, string> = {
  info: "Info",
  running: "Running",
  pending: "Pending",
  success: "Success",
  completed: "Completed",
  failed: "Failed",
  error: "Error",
  cancelled: "Cancelled",
  skipped: "Skipped",
  warning: "Warning",
};

function normalizeStatus(status: string): string {
  return status.toLowerCase().replace(/\s+/g, "_");
}

export function StatusBadge({ status, pulse, className }: StatusBadgeProps) {
  const normalized = normalizeStatus(status);
  const variant = STATUS_VARIANTS[normalized as Status] ?? "secondary";
  const label = STATUS_LABELS[normalized as Status] ?? status;
  const isLive = normalized === "running" || normalized === "pending";
  const showPulse = pulse ?? isLive;

  return (
    <Badge variant={variant} className={cn("font-mono uppercase", className)}>
      {showPulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-pulse rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-full w-full rounded-full bg-current" />
        </span>
      )}
      {label}
    </Badge>
  );
}
