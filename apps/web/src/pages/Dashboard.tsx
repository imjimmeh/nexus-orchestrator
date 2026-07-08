import * as React from "react";
import { Link } from "react-router-dom";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProjectList } from "@/hooks/useProjects";
import { useWorkflowRuns } from "@/hooks/useWorkflows";
import { useAgentProfiles } from "@/hooks/useAgentProfiles";
import { useProjectOrchestrationSummaries } from "@/hooks/useProjectOrchestrationSummaries";
import { ProjectSummaryCard } from "@/components/projects/ProjectSummaryCard";
import {
  FolderKanban,
  Activity,
  Bot,
  Plus,
  Zap,
  ArrowRight,
} from "lucide-react";
import { ProjectOrchestrationStatus } from "@/lib/api/projects.types";
import { WorkflowRun } from "@/lib/api/workflows.types";
import { formatDistanceToNowSafe, cn } from "@/lib/utils";
import { StatusBadge } from "@/components/ui/status-badge";
import { ActivityFeed, QuickActions } from "./dashboard/DashboardWidgets";
import { ErrorBoundary } from "@/components/error-boundary/ErrorBoundary";

interface StatCardProps {
  title: string;
  value: number;
  icon: React.ReactNode;
  href: string;
  status: "info" | "success" | "warning" | "error" | "neutral";
  isLoading?: boolean;
}

interface DashboardStat {
  title: string;
  value: number;
  icon: React.ReactNode;
  href: string;
  status: "info" | "success" | "warning" | "error" | "neutral";
  isLoading: boolean;
}

type DashboardProject = NonNullable<
  ReturnType<typeof useProjectList>["data"]
>[number];

function buildDashboardStats(params: {
  projectCount: number;
  activeRunCount: number;
  agentCount: number;
  orchestratingCount: number;
  projectsLoading: boolean;
  runsLoading: boolean;
  agentsLoading: boolean;
}): DashboardStat[] {
  const {
    projectCount,
    activeRunCount,
    agentCount,
    orchestratingCount,
    projectsLoading,
    runsLoading,
    agentsLoading,
  } = params;

  return [
    {
      title: "Projects",
      value: projectCount,
      icon: <FolderKanban className="h-4 w-4" />,
      href: "/projects",
      status: projectCount > 0 ? "success" : "neutral",
      isLoading: projectsLoading,
    },
    {
      title: "Active Orchestrations",
      value: orchestratingCount,
      icon: <Zap className="h-4 w-4" />,
      href: "/projects",
      status: orchestratingCount > 0 ? "info" : "neutral",
      isLoading: projectsLoading,
    },
    {
      title: "Active Runs",
      value: activeRunCount,
      icon: <Activity className="h-4 w-4" />,
      href: "/sessions",
      status: activeRunCount > 0 ? "info" : "neutral",
      isLoading: runsLoading,
    },
    {
      title: "Agent Profiles",
      value: agentCount,
      icon: <Bot className="h-4 w-4" />,
      href: "/agents",
      status: agentCount > 0 ? "warning" : "neutral",
      isLoading: agentsLoading,
    },
  ];
}

const ACTIVE_ORCHESTRATION_STATUSES = new Set<ProjectOrchestrationStatus>([
  "initializing",
  "awaiting_approval",
  "bootstrapping",
  "orchestrating",
]);

const STATUS_BORDER_CLASSES = {
  info: "border-l-info",
  success: "border-l-success",
  warning: "border-l-warning",
  error: "border-l-error",
  neutral: "border-l-border",
};

function StatCard({
  title,
  value,
  icon,
  href,
  status,
  isLoading,
}: Readonly<StatCardProps>) {
  return (
    <Card
      className={cn(
        "group border-l-4 transition-shadow hover:shadow-sm",
        STATUS_BORDER_CLASSES[status],
      )}
    >
      <Link to={href} className="block">
        <CardContent className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-muted-foreground">
              {title}
            </span>
            <div className="text-muted-foreground">{icon}</div>
          </div>
          <div className="flex items-end justify-between gap-3">
            {isLoading ? (
              <div className="h-8 w-16 animate-pulse rounded bg-muted" />
            ) : (
              <div className="text-3xl font-bold tracking-tight">{value}</div>
            )}
            <span className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-foreground">
              View details
              <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </div>
        </CardContent>
      </Link>
    </Card>
  );
}

interface DashboardProjectsSectionProps {
  projectsLoading: boolean;
  projects: DashboardProject[];
  orchestrationByProjectId: Map<
    string,
    { status: ProjectOrchestrationStatus } | null
  >;
}

function DashboardProjectsSection({
  projectsLoading,
  projects,
  orchestrationByProjectId,
}: Readonly<DashboardProjectsSectionProps>) {
  let content: React.ReactNode;

  if (projectsLoading) {
    content = (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <Card key={i}>
            <CardHeader>
              <div className="h-6 w-40 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-4 w-full animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  } else if (projects.length === 0) {
    content = (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
          <FolderKanban className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="mb-2 text-lg font-medium">No projects yet</p>
          <p className="mb-4 text-sm text-muted-foreground">
            Create your first project to get started.
          </p>
          <Button asChild>
            <Link to="/projects/new">
              <Plus className="mr-2 h-4 w-4" />
              Create Project
            </Link>
          </Button>
        </CardContent>
      </Card>
    );
  } else {
    content = (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.slice(0, 6).map((project) => {
          const orch = orchestrationByProjectId.get(project.id);
          return (
            <ProjectSummaryCard
              key={project.id}
              project={project}
              orchestrationStatus={orch?.status}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-semibold">Your Projects</h3>
        <Button variant="outline" size="sm" asChild>
          <Link to="/projects">View All</Link>
        </Button>
      </div>
      {content}
    </div>
  );
}

function ActiveRunsSection({
  activeRuns,
}: Readonly<{ activeRuns: WorkflowRun[] }>) {
  if (activeRuns.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Runs</CardTitle>
        <CardDescription>Currently executing workflow runs</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activeRuns.slice(0, 5).map((run: WorkflowRun) => (
            <Link
              key={run.id}
              to={`/workflows/${run.workflow_id}/runs/${run.id}`}
              className="flex items-center justify-between border-b pb-2 transition-colors last:border-0 last:pb-0 hover:text-foreground"
            >
              <div className="flex items-center gap-3">
                <StatusBadge status="info" pulse />
                <div>
                  <p className="text-sm font-medium">{run.id.slice(0, 8)}...</p>
                  {run.current_step_id ? (
                    <p className="text-xs text-muted-foreground">
                      Step: {run.current_step_id}
                    </p>
                  ) : null}
                </div>
              </div>
              <span className="text-xs text-muted-foreground">
                {formatDistanceToNowSafe(
                  run.started_at ?? run.created_at,
                  "Started recently",
                )}
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function Dashboard() {
  const { data: projects = [], isLoading: projectsLoading } = useProjectList();
  const { data: runs = [], isLoading: runsLoading } = useWorkflowRuns();
  const { data: agents = [], isLoading: agentsLoading } = useAgentProfiles();
  const { orchestrationByProjectId } =
    useProjectOrchestrationSummaries(projects);
  const activeRuns = runs.filter(
    (r: WorkflowRun) => r.status === "RUNNING" || r.status === "PENDING",
  );

  const orchestratingCount = React.useMemo(() => {
    let count = 0;
    for (const orch of orchestrationByProjectId.values()) {
      if (orch && ACTIVE_ORCHESTRATION_STATUSES.has(orch.status)) {
        count++;
      }
    }
    return count;
  }, [orchestrationByProjectId]);

  const stats = buildDashboardStats({
    projectCount: projects.length,
    activeRunCount: activeRuns.length,
    agentCount: agents.length,
    orchestratingCount,
    projectsLoading,
    runsLoading,
    agentsLoading,
  });

  return (
    <div className="space-y-10 animate-in-fade">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted-foreground">
            Overview of your projects and active work
          </p>
        </div>
        <Button asChild className="mt-3 sm:mt-0">
          <Link to="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>

      <ErrorBoundary>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stats.map((stat) => (
            <StatCard key={stat.title} {...stat} />
          ))}
        </div>
      </ErrorBoundary>

      <div className="grid gap-6 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <QuickActions hasActiveRuns={activeRuns.length > 0} />
        </div>
        <div className="xl:col-span-2">
          <ActivityFeed activeRuns={activeRuns} />
        </div>
      </div>

      <DashboardProjectsSection
        projectsLoading={projectsLoading}
        projects={projects}
        orchestrationByProjectId={orchestrationByProjectId}
      />

      <ActiveRunsSection activeRuns={activeRuns} />
    </div>
  );
}
