import { Link } from "react-router-dom";
import { useProjectList } from "@/hooks/useProjects";
import { useProjectOrchestrationSummaries } from "@/hooks/useProjectOrchestrationSummaries";
import { Button } from "@/components/ui/button";
import { ProjectSummaryCard } from "@/components/projects/ProjectSummaryCard";
import { EmptyState } from "@/components/ui/empty-state";
import { CardSkeleton } from "@/components/ui/skeleton";
import { FolderKanban, Plus } from "lucide-react";

export function Projects() {
  const { data: projects = [], isLoading } = useProjectList();
  const { orchestrationByProjectId } =
    useProjectOrchestrationSummaries(projects);

  let content: React.ReactNode;
  if (isLoading) {
    content = (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    );
  } else if (projects.length === 0) {
    content = (
      <EmptyState
        icon={FolderKanban}
        title="No projects yet"
        description="Create your first project to get started with AI-assisted development."
        ctaLabel="Create Project"
        ctaHref="/projects/new"
      />
    );
  } else {
    content = (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {projects.map((project) => {
          const orchestration = orchestrationByProjectId.get(project.id);
          return (
            <ProjectSummaryCard
              key={project.id}
              project={project}
              orchestrationStatus={orchestration?.status}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Projects</h2>
          <p className="text-muted-foreground">
            Manage and navigate your development projects.
          </p>
        </div>
        <Button asChild>
          <Link to="/projects/new">
            <Plus className="mr-2 h-4 w-4" />
            New Project
          </Link>
        </Button>
      </div>
      {content}
    </div>
  );
}
