import { Badge } from "@/components/ui/badge";

export type WorkflowRunPhase =
  | "Planning"
  | "Delegation"
  | "Implementation"
  | "Review Handoff";

type WorkflowRunPhasesBannerProps = {
  phaseMarkers: WorkflowRunPhase[];
};

export function WorkflowRunPhasesBanner({
  phaseMarkers,
}: Readonly<WorkflowRunPhasesBannerProps>) {
  if (phaseMarkers.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">Run phases:</span>
      {phaseMarkers.map((phase) => (
        <Badge key={phase} variant="secondary">
          {phase}
        </Badge>
      ))}
    </div>
  );
}
