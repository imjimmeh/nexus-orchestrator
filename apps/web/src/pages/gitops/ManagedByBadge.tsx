import { Badge } from "@/components/ui/badge";
import type { ManagedBy } from "@/lib/api/client.gitops.types";

const VARIANT_MAP: Record<
  ManagedBy,
  "default" | "secondary" | "outline" | "destructive"
> = {
  gitops: "default",
  manual: "destructive",
  seed: "secondary",
};

interface ManagedByBadgeProps {
  managedBy: string;
}

export function ManagedByBadge({ managedBy }: ManagedByBadgeProps) {
  const variant = VARIANT_MAP[managedBy as ManagedBy] ?? "outline";
  return <Badge variant={variant}>{managedBy}</Badge>;
}
