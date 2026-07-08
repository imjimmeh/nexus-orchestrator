import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { formatDistanceToNowSafe } from "@/lib/utils";
import { Project, ProjectOrchestrationStatus } from "@/lib/api/projects.types";
import { GitBranch, LayoutDashboard, Monitor, Plus, Zap } from "lucide-react";

const ACTIVE_ORCHESTRATION_STATUSES = new Set<ProjectOrchestrationStatus>([
  "initializing",
  "awaiting_approval",
  "bootstrapping",
  "orchestrating",
]);

function orchestrationBadgeVariant(
  status: ProjectOrchestrationStatus,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "completed") return "secondary";
  if (ACTIVE_ORCHESTRATION_STATUSES.has(status)) return "default";
  return "outline";
}

function calculateHealthScore(
  status?: ProjectOrchestrationStatus | null,
): number {
  if (!status) {
    return 72;
  }

  if (status === "failed") {
    return 35;
  }

  if (status === "completed") {
    return 88;
  }

  if (ACTIVE_ORCHESTRATION_STATUSES.has(status)) {
    return 78;
  }

  return 65;
}

function healthColorClass(score: number): string {
  if (score < 50) {
    return "bg-error";
  }
  if (score <= 75) {
    return "bg-warning";
  }
  return "bg-success";
}

interface ProjectSummaryCardProps {
  project: Project;
  orchestrationStatus?: ProjectOrchestrationStatus | null;
  showActions?: boolean;
}

export function ProjectSummaryCard({
  project,
  orchestrationStatus,
  showActions = true,
}: Readonly<ProjectSummaryCardProps>) {
  const healthScore = calculateHealthScore(orchestrationStatus);

  return (
    <Card className="flex h-full flex-col hover:border-primary/50">
      <Link to={`/projects/${project.id}`} className="flex flex-1 flex-col">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg leading-snug">
              {project.name}
            </CardTitle>
            <div className="flex shrink-0 gap-1">
              {orchestrationStatus ? (
                <Badge variant={orchestrationBadgeVariant(orchestrationStatus)}>
                  {orchestrationStatus}
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  no orchestration
                </Badge>
              )}
              {project.repositoryUrl && (
                <Badge variant="outline" className="shrink-0">
                  <GitBranch className="mr-1 h-3 w-3" />
                  Repo
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {project.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">
              {project.description}
            </p>
          )}

          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>Project health</span>
              <span className="font-semibold text-foreground">
                {healthScore}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div
                className={`h-full rounded-full ${healthColorClass(healthScore)}`}
                style={{ width: `${healthScore}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Updated {formatDistanceToNowSafe(project.updated_at, "recently")}
          </p>
        </CardContent>
      </Link>
      {showActions ? (
        <CardFooter className="gap-1 border-t px-4 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            asChild
          >
            <Link to={`/projects/${project.id}?tab=board`}>
              <LayoutDashboard className="mr-1 h-3 w-3" />
              Board
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            asChild
          >
            <Link to={`/projects/${project.id}?tab=sessions`}>
              <Monitor className="mr-1 h-3 w-3" />
              Sessions
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            asChild
          >
            <Link to={`/projects/${project.id}?tab=orchestration`}>
              <Zap className="mr-1 h-3 w-3" />
              Orchestration
            </Link>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            asChild
          >
            <Link to={`/projects/${project.id}?tab=board`}>
              <Plus className="mr-1 h-3 w-3" />
              New Work Item
            </Link>
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}
