import type { AssignmentTarget } from "@nexus/core";
import { Badge } from "@/components/ui/badge";
import { describeAssignmentTarget } from "./skill-proposal-detail.helpers";

export interface SkillAssignmentTargetListProps {
  title: string;
  targets: AssignmentTarget[];
  emptyLabel?: string;
}

/** Presentational list of assignment targets (agent profile / workflow step). */
export function SkillAssignmentTargetList({
  title,
  targets,
  emptyLabel = "No targets",
}: SkillAssignmentTargetListProps) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold uppercase text-muted-foreground">
        {title}
      </h4>
      {targets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {targets.map((target, index) => (
            <li key={`${describeAssignmentTarget(target)}-${index}`}>
              <Badge variant="outline">
                {describeAssignmentTarget(target)}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
