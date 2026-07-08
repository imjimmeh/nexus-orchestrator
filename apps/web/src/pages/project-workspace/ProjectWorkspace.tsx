import { lazy, Suspense, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Rocket } from "lucide-react";
import { toast } from "sonner";
import { useProject } from "@/hooks/useProjects";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ProjectWorkflowQuickLaunchDialog } from "./ProjectWorkflowQuickLaunchDialog";
import { ErrorBoundary } from "@/components/error-boundary/ErrorBoundary";
import { api } from "@/lib/api/client";

const KanbanBoard = lazy(async () => {
  const loadedModule = await import("@/pages/kanban/KanbanBoard");
  return { default: loadedModule.KanbanBoard };
});

const SessionsTab = lazy(async () => {
  const loadedModule = await import("./SessionsTab");
  return { default: loadedModule.SessionsTab };
});

const SettingsTab = lazy(async () => {
  const loadedModule = await import("./SettingsTab");
  return { default: loadedModule.SettingsTab };
});

const OrchestrationTab = lazy(async () => {
  const loadedModule = await import("./OrchestrationTab");
  return { default: loadedModule.OrchestrationTab };
});

const BranchesTab = lazy(async () => {
  const loadedModule = await import("./BranchesTab");
  return { default: loadedModule.BranchesTab };
});

const AgentsTab = lazy(async () => {
  const loadedModule = await import("./AgentsTab");
  return { default: loadedModule.AgentsTab };
});

const ProjectIntentTab = lazy(async () => {
  const loadedModule = await import("./ProjectIntentTab");
  return { default: loadedModule.ProjectIntentTab };
});

const EventsTab = lazy(async () => {
  const loadedModule = await import("./EventsTab");
  return { default: loadedModule.EventsTab };
});

const SchedulesTab = lazy(async () => {
  const loadedModule = await import("./SchedulesTab");
  return { default: loadedModule.SchedulesTab };
});

const LearningTab = lazy(async () => {
  const loadedModule = await import("./LearningTab");
  return { default: loadedModule.LearningTab };
});

const MemoryTab = lazy(async () => {
  const loadedModule = await import("./MemoryTab");
  return { default: loadedModule.MemoryTab };
});

const RepositoryWorkflowsTab = lazy(async () => {
  const loadedModule = await import("./RepositoryWorkflowsTab");
  return { default: loadedModule.RepositoryWorkflowsTab };
});

const FilesTab = lazy(async () => {
  const { AddFilesPanel } = await import("@/components/attachments");
  // Wrap AddFilesPanel so it can be used as a lazy tab — projectId is injected at call site
  return {
    default: ({ projectId }: { projectId: string }) => (
      <AddFilesPanel projectId={projectId} className="pt-4" />
    ),
  };
});

type WorkspaceTab =
  | "board"
  | "charter"
  | "files"
  | "learning"
  | "memory"
  | "orchestration"
  | "schedules"
  | "events"
  | "branches"
  | "agents"
  | "sessions"
  | "settings"
  | "repository-workflows";

const VALID_TABS = new Set<WorkspaceTab>([
  "board",
  "charter",
  "files",
  "learning",
  "memory",
  "orchestration",
  "schedules",
  "events",
  "branches",
  "agents",
  "sessions",
  "settings",
  "repository-workflows",
]);

function isValidTab(value: string): value is WorkspaceTab {
  return VALID_TABS.has(value as WorkspaceTab);
}

interface ProjectWorkspaceHeaderProps {
  readonly isLoading: boolean;
  readonly projectName: string | undefined;
  readonly projectDescription: string | undefined;
  readonly projectId: string;
  readonly onQuickLaunch: () => void;
  readonly onRefineCharter: () => Promise<void>;
}

function ProjectWorkspaceHeader({
  isLoading,
  projectName,
  projectDescription,
  projectId,
  onQuickLaunch,
  onRefineCharter,
}: Readonly<ProjectWorkspaceHeaderProps>) {
  return (
    <div className="flex items-center justify-between">
      <div>
        {isLoading ? (
          <div className="h-8 w-64 animate-pulse rounded bg-muted" />
        ) : (
          <h2 className="text-3xl font-bold tracking-tight">
            {projectName ?? "Project"}
          </h2>
        )}
        <p className="text-muted-foreground">
          {projectDescription || `Project ${projectId.slice(0, 8)}...`}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="outline" onClick={onRefineCharter}>
          Refine Charter
        </Button>
        <Button variant="outline" onClick={onQuickLaunch}>
          <Rocket className="mr-2 h-4 w-4" />
          Quick Launch Workflow
        </Button>
      </div>
    </div>
  );
}

function TabContentFallback() {
  return (
    <div className="space-y-3 pt-4" aria-live="polite" aria-busy="true">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-28 w-full animate-pulse rounded bg-muted" />
      <div className="h-28 w-full animate-pulse rounded bg-muted" />
    </div>
  );
}

export function ProjectWorkspace() {
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [quickLaunchOpen, setQuickLaunchOpen] = useState<boolean>(false);

  const rawTab = searchParams.get("tab") ?? "board";
  const activeTab: WorkspaceTab = isValidTab(rawTab) ? rawTab : "board";

  const { data: project, isLoading } = useProject(projectId);

  const handleTabChange = (value: string) => {
    if (isValidTab(value)) {
      setSearchParams({ tab: value }, { replace: true });
    }
  };

  if (!projectId) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-muted-foreground">Project ID is required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ProjectWorkspaceHeader
        isLoading={isLoading}
        projectName={project?.name}
        projectDescription={project?.description ?? undefined}
        projectId={projectId}
        onQuickLaunch={() => {
          setQuickLaunchOpen(true);
        }}
        onRefineCharter={async () => {
          try {
            await api.launchCharterOnboarding(projectId, "refine");
            toast.success("Charter refinement started", {
              description:
                "The CEO agent will walk you through updating the project charter.",
            });
            setSearchParams({ tab: "sessions" }, { replace: true });
          } catch {
            toast.error("Failed to start charter refinement", {
              description: "Check the sessions tab for details.",
            });
          }
        }}
      />

      <ErrorBoundary>
        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            <TabsTrigger value="board">Board</TabsTrigger>
            <TabsTrigger value="charter">Project Intent</TabsTrigger>
            <TabsTrigger value="files">Files</TabsTrigger>
            <TabsTrigger value="learning">Learning</TabsTrigger>
            <TabsTrigger value="memory">Memory</TabsTrigger>
            <TabsTrigger value="orchestration">Orchestration</TabsTrigger>
            <TabsTrigger value="schedules">Schedules</TabsTrigger>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="branches">Branches</TabsTrigger>
            <TabsTrigger value="agents">AGENTS</TabsTrigger>
            <TabsTrigger value="sessions">Sessions</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="repository-workflows">
              Repository Workflows
            </TabsTrigger>
          </TabsList>

          <TabsContent value="board">
            <Suspense fallback={<TabContentFallback />}>
              <KanbanBoard />
            </Suspense>
          </TabsContent>

          <TabsContent value="charter">
            <Suspense fallback={<TabContentFallback />}>
              <ProjectIntentTab
                projectId={projectId}
                onLaunchRefine={async () => {
                  try {
                    await api.launchCharterOnboarding(projectId, "refine");
                    toast.success("Charter refinement started");
                    setSearchParams({ tab: "sessions" }, { replace: true });
                  } catch {
                    toast.error("Failed to start charter refinement");
                  }
                }}
              />
            </Suspense>
          </TabsContent>

          <TabsContent value="files">
            <Suspense fallback={<TabContentFallback />}>
              <FilesTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="learning">
            <Suspense fallback={<TabContentFallback />}>
              <LearningTab />
            </Suspense>
          </TabsContent>

          <TabsContent value="memory">
            <Suspense fallback={<TabContentFallback />}>
              <MemoryTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="orchestration">
            <Suspense fallback={<TabContentFallback />}>
              <OrchestrationTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="schedules">
            <Suspense fallback={<TabContentFallback />}>
              <SchedulesTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="events">
            <Suspense fallback={<TabContentFallback />}>
              <EventsTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="branches">
            <Suspense fallback={<TabContentFallback />}>
              <BranchesTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="agents">
            <Suspense fallback={<TabContentFallback />}>
              <AgentsTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="sessions">
            <Suspense fallback={<TabContentFallback />}>
              <SessionsTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="settings">
            <Suspense fallback={<TabContentFallback />}>
              <SettingsTab projectId={projectId} />
            </Suspense>
          </TabsContent>

          <TabsContent value="repository-workflows">
            <Suspense fallback={<TabContentFallback />}>
              <RepositoryWorkflowsTab
                projectId={projectId}
                repositoryRootPath={project?.basePath ?? null}
              />
            </Suspense>
          </TabsContent>
        </Tabs>
      </ErrorBoundary>

      <ProjectWorkflowQuickLaunchDialog
        open={quickLaunchOpen}
        onOpenChange={setQuickLaunchOpen}
        projectId={projectId}
      />
    </div>
  );
}
