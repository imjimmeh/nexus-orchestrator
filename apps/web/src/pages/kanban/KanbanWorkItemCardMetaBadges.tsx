import { Badge } from "@/components/ui/badge";
import { WorkItem } from "@/lib/api/work-items.types";
import { StoryPointChip } from "@/features/kanban/story-point-chip";
import { WorkItemTypeBadge } from "@/features/kanban/work-item-type-badge";
import { getDependencyLabel } from "./kanban-card-ui";

interface KanbanWorkItemCardMetaBadgesProps {
  item: WorkItem;
  blockerCount: number;
  planState: string;
}

export function KanbanWorkItemCardMetaBadges({
  item,
  blockerCount,
  planState,
}: Readonly<KanbanWorkItemCardMetaBadgesProps>) {
  return (
    <div className="mb-2 flex flex-wrap gap-1">
      <WorkItemTypeBadge type={item.type} />
      <StoryPointChip item={item} readOnly />
      <Badge variant="outline">{getDependencyLabel(item)}</Badge>
      {blockerCount > 0 ? <Badge variant="destructive">Blocked</Badge> : null}
      <Badge variant={planState === "delta replan" ? "destructive" : "outline"}>
        {planState}
      </Badge>
    </div>
  );
}
