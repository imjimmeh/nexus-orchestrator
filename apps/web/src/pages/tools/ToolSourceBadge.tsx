import { Badge } from "@/components/ui/badge";
import type { ToolRegistrySource } from "@nexus/core";
import { getToolSourceLabel, isManualToolSource } from "./tool-source";

interface ToolSourceBadgeProps {
  source: ToolRegistrySource;
}

export function ToolSourceBadge({ source }: Readonly<ToolSourceBadgeProps>) {
  return (
    <Badge variant={isManualToolSource(source) ? "secondary" : "outline"}>
      {getToolSourceLabel(source)}
    </Badge>
  );
}
