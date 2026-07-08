import {
  CircleDollarSign,
  GitPullRequestArrow,
  Radio,
  Timer,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkItemLiveState } from "@/lib/api/work-items.types";
import { getLiveBadgeClass } from "./kanban.board-helpers";

interface KanbanWorkItemCardFooterStatsProps {
  liveState: WorkItemLiveState;
  dependencyCount: number;
  tokenSpend: number;
  costCents?: number;
}

function formatCostCents(cents: number): string {
  if (cents === 0) return "$0";
  if (cents < 100) return `<$0.01`;
  return `$${(cents / 100).toFixed(2)}`;
}

export function KanbanWorkItemCardFooterStats({
  liveState,
  dependencyCount,
  tokenSpend,
  costCents = 0,
}: Readonly<KanbanWorkItemCardFooterStatsProps>) {
  return (
    <div className="flex items-center justify-between gap-2 border-t pt-2">
      <Badge className={getLiveBadgeClass(liveState)}>
        <Radio className="mr-1 h-3 w-3" />
        {liveState}
      </Badge>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1" title="Dependencies">
          <GitPullRequestArrow className="h-3 w-3" />
          {dependencyCount}
        </span>
        <span className="inline-flex items-center gap-1" title="Token usage">
          <Timer className="h-3 w-3" />
          {tokenSpend}
        </span>
        {costCents > 0 && (
          <span
            className="inline-flex items-center gap-1"
            title="Estimated cost"
          >
            <CircleDollarSign className="h-3 w-3" />
            {formatCostCents(costCents)}
          </span>
        )}
      </div>
    </div>
  );
}
