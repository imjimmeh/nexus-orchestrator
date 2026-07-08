import { Badge } from "@/components/ui/badge";
import { ProjectOrchestration } from "@/lib/api/projects.types";

function resolvePhaseState(params: {
  status: ProjectOrchestration["status"];
  index: number;
}): "done" | "active" | "pending" {
  const { status, index } = params;

  const phaseByStatus: Record<ProjectOrchestration["status"], number> = {
    idle: 0,
    initializing: 1,
    awaiting_approval: 2,
    bootstrapping: 3,
    orchestrating: 4,
    paused: 4,
    completed: 4,
    failed: 4,
  };

  const activePhase = phaseByStatus[status] ?? 0;
  if (index < activePhase) {
    return "done";
  }

  if (index === activePhase) {
    return "active";
  }

  return "pending";
}

function phaseBadgeVariant(
  phaseState: "done" | "active" | "pending",
): "default" | "secondary" | "outline" {
  switch (phaseState) {
    case "done":
      return "secondary";
    case "active":
      return "default";
    default:
      return "outline";
  }
}

interface ProcessPhasesPanelProps {
  status: ProjectOrchestration["status"];
}

export function ProcessPhasesPanel({
  status,
}: Readonly<ProcessPhasesPanelProps>) {
  return (
    <div className="rounded-md border p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Process Phases
      </p>
      {[
        "1. Discovery and spec generation",
        "2. Human approval gate",
        "3. Work-item generation bootstrap",
        "4. Continuous orchestration cycle",
      ].map((phaseLabel, index) => {
        const phaseState = resolvePhaseState({
          status,
          index: index + 1,
        });

        return (
          <div
            key={phaseLabel}
            className="mb-1 flex items-center gap-2 text-sm last:mb-0"
          >
            <Badge variant={phaseBadgeVariant(phaseState)}>{phaseState}</Badge>
            <span
              className={
                phaseState === "pending" ? "text-muted-foreground" : ""
              }
            >
              {phaseLabel}
            </span>
          </div>
        );
      })}
    </div>
  );
}
