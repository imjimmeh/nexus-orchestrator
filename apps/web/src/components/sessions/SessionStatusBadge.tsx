import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SessionStatusBadgeKind = "chat" | "workflow" | "subagent";

export function getSessionStatusBadgeVariant(
  kind: SessionStatusBadgeKind,
  status: string,
): "default" | "secondary" | "destructive" | "outline" {
  const normalizedStatus = status.toUpperCase();
  if (kind === "chat" || kind === "subagent") {
    if (normalizedStatus === "RUNNING" || normalizedStatus === "STARTING") {
      return "default";
    }
    if (normalizedStatus === "FAILED" || normalizedStatus === "CANCELLED") {
      return "destructive";
    }
    return "outline";
  }

  if (normalizedStatus === "RUNNING" || normalizedStatus === "PENDING") {
    return "default";
  }
  if (normalizedStatus === "FAILED" || normalizedStatus === "CANCELLED") {
    return "destructive";
  }
  return "outline";
}

export function SessionStatusBadge({
  kind,
  status,
  className,
}: Readonly<{
  kind: SessionStatusBadgeKind;
  status: string;
  className?: string;
}>) {
  return (
    <Badge
      variant={getSessionStatusBadgeVariant(kind, status)}
      className={cn(
        "text-[10px] h-4 px-1 py-0 uppercase tracking-tight",
        className,
      )}
    >
      {status}
    </Badge>
  );
}
