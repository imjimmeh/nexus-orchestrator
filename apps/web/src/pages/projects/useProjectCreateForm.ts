import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api/client";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { useToast } from "@/hooks/useToast";
import { CreateProjectGoalRequest, ProjectGoalMoscow, ProjectGoalPriority } from "@/lib/api/goals.types";
import { formatDistanceToNowSafe } from "@/lib/utils";

type DraftGoal = {
  id: string;
  title: string;
  description: string;
  moscow: ProjectGoalMoscow | "";
  priority: ProjectGoalPriority | "";
  targetDate: string;
};

type ProjectSourceType = "create_new" | "import_local" | "import_remote";

interface ProjectCreateDraft {
  name: string;
  description: string;
  sourceType: ProjectSourceType;
  repositoryUrl: string;
  basePath: string;
  copyToWorkspace: boolean;
  githubSecretId: string;
  goals: DraftGoal[];
  startOnboarding: boolean;
  savedAt: string | null;
}

const PROJECT_CREATE_DRAFT_KEY = "nexus.projects.create.draft";

function createEmptyGoal(id: string): DraftGoal {
  return {
    id,
    title: "",
    description: "",
    moscow: "",
    priority: "",
    targetDate: "",
  };
}

function toCreateProjectGoalsPayload(
  goals: DraftGoal[],
): CreateProjectGoalRequest[] {
  return goals
    .map((goal) => ({
      title: goal.title.trim(),
      description: goal.description.trim() || undefined,
      moscow: goal.moscow || undefined,
      priority: goal.priority || undefined,
      target_date: goal.targetDate || undefined,
    }))
    .filter((goal) => goal.title.length > 0);
}

export function useProjectCreateForm() {
  const state = useProjectCreateDraftState();
  const createProject = useProjectCreateMutation({
    name: state.name,
    description: state.description,
    sourceType: state.sourceType,
    repositoryUrl: state.repositoryUrl,
    basePath: state.basePath,
    copyToWorkspace: state.copyToWorkspace,
    githubSecretId: state.githubSecretId,
    goals: state.goals,
    startOnboarding: state.startOnboarding,
    toast: state.toast,
    setError: state.setError,
    clearSavedDraft: state.clearSavedDraft,
  });

  const submit = async () => {
    state.setError(null);

    if (!state.name.trim()) {
      state.setError("Project name is required.");
      state.toast.warning("Project name is required");
      return;
    }

    if (state.sourceType === "import_remote" && !state.repositoryUrl.trim()) {
      state.setError("Repository URL is required when importing from remote.");
      state.toast.warning("Repository URL is required for remote import");
      return;
    }

    if (state.sourceType === "import_local" && !state.basePath.trim()) {
      state.setError("Local path is required when importing from filesystem.");
      state.toast.warning("Local path is required for filesystem import");
      return;
    }

    // Validate local path for import_local and create_new
    if (
      (state.sourceType === "import_local" ||
        state.sourceType === "create_new") &&
      state.basePath.trim()
    ) {
      try {
        const result = await api.validateLocalPath({
          path: state.basePath.trim(),
          sourceType: state.sourceType,
        });

        if (!result.valid) {
          state.setError(result.error || "Path validation failed");
          state.toast.warning(
            "Invalid path",
            result.error || "Path validation failed",
          );
          return;
        }
      } catch {
        // If validation endpoint is unavailable, continue anyway
        console.warn(
          "Path validation endpoint unavailable, proceeding without validation",
        );
      }
    }

    createProject.mutate();
  };

  return {
    name: state.name,
    description: state.description,
    sourceType: state.sourceType,
    repositoryUrl: state.repositoryUrl,
    basePath: state.basePath,
    copyToWorkspace: state.copyToWorkspace,
    githubSecretId: state.githubSecretId,
    goals: state.goals,
    startOnboarding: state.startOnboarding,
    error: state.error,
    lastSavedLabel: state.lastSavedLabel,
    isSubmitting: createProject.isPending,
    setName: state.setName,
    setDescription: state.setDescription,
    setSourceType: state.setSourceType,
    setRepositoryUrl: state.setRepositoryUrl,
    setBasePath: state.setBasePath,
    setCopyToWorkspace: state.setCopyToWorkspace,
    setGithubSecretId: state.setGithubSecretId,
    setStartOnboarding: state.setStartOnboarding,
    addGoal: state.addGoal,
    removeGoal: state.removeGoal,
    updateGoal: state.updateGoal,
    updateGoalMoscow: state.updateGoalMoscow,
    updateGoalPriority: state.updateGoalPriority,
    submit,
  };
}

function useProjectCreateDraftState() {
  const toast = useToast();
  const {
    value: savedDraft,
    setValue: setSavedDraft,
    reset: clearSavedDraft,
  } = useLocalStorage<ProjectCreateDraft>(PROJECT_CREATE_DRAFT_KEY, {
    name: "",
    description: "",
    sourceType: "create_new",
    repositoryUrl: "",
    basePath: "",
    copyToWorkspace: true,
    githubSecretId: "",
    goals: [],
    startOnboarding: false,
    savedAt: null,
  });

  const [name, setName] = useState(savedDraft.name);
  const [description, setDescription] = useState(savedDraft.description);
  const [sourceType, setSourceType] = useState<ProjectSourceType>(
    savedDraft.sourceType,
  );
  const [repositoryUrl, setRepositoryUrl] = useState(savedDraft.repositoryUrl);
  const [basePath, setBasePath] = useState(savedDraft.basePath);
  const [copyToWorkspace, setCopyToWorkspace] = useState(
    savedDraft.copyToWorkspace,
  );
  const [githubSecretId, setGithubSecretId] = useState(
    savedDraft.githubSecretId,
  );
  const [goals, setGoals] = useState<DraftGoal[]>(savedDraft.goals);
  const [startOnboarding, setStartOnboarding] = useState(
    savedDraft.startOnboarding ?? false,
  );
  const [error, setError] = useState<string | null>(null);
  const goalActions = useGoalDraftActions(setGoals);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSavedDraft({
        name,
        description,
        sourceType,
        repositoryUrl,
        basePath,
        copyToWorkspace,
        githubSecretId,
        goals,
        startOnboarding,
        savedAt: new Date().toISOString(),
      });
    }, 2000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    basePath,
    copyToWorkspace,
    description,
    githubSecretId,
    goals,
    name,
    sourceType,
    repositoryUrl,
    startOnboarding,
    setSavedDraft,
  ]);

  const lastSavedLabel = useMemo(() => {
    if (!savedDraft.savedAt) {
      return "Draft not saved yet";
    }
    return `Last saved ${formatDistanceToNowSafe(savedDraft.savedAt, "just now")}`;
  }, [savedDraft.savedAt]);

  return {
    toast,
    clearSavedDraft,
    name,
    description,
    sourceType,
    repositoryUrl,
    basePath,
    copyToWorkspace,
    githubSecretId,
    goals,
    startOnboarding,
    error,
    lastSavedLabel,
    setName,
    setDescription,
    setSourceType,
    setRepositoryUrl,
    setBasePath,
    setCopyToWorkspace,
    setGithubSecretId,
    setStartOnboarding,
    setError,
    ...goalActions,
  };
}

function useGoalDraftActions(setGoals: Dispatch<SetStateAction<DraftGoal[]>>) {
  const addGoal = () => {
    setGoals((current) => [
      ...current,
      createEmptyGoal(`${Date.now()}-${current.length}`),
    ]);
  };

  const removeGoal = (goalId: string) => {
    setGoals((current) => current.filter((item) => item.id !== goalId));
  };

  const updateGoal = (goalId: string, patch: Partial<DraftGoal>) => {
    setGoals((current) =>
      current.map((item) =>
        item.id === goalId ? { ...item, ...patch } : item,
      ),
    );
  };

  const updateGoalMoscow = (goalId: string, value: string) => {
    updateGoal(goalId, {
      moscow: value === "__none__" ? "" : (value as ProjectGoalMoscow),
    });
  };

  const updateGoalPriority = (goalId: string, value: string) => {
    updateGoal(goalId, {
      priority: value === "__none__" ? "" : (value as ProjectGoalPriority),
    });
  };

  return {
    addGoal,
    removeGoal,
    updateGoal,
    updateGoalMoscow,
    updateGoalPriority,
  };
}

function useProjectCreateMutation(params: {
  name: string;
  description: string;
  sourceType: ProjectSourceType;
  repositoryUrl: string;
  basePath: string;
  copyToWorkspace: boolean;
  githubSecretId: string;
  goals: DraftGoal[];
  startOnboarding: boolean;
  toast: ReturnType<typeof useToast>;
  setError: (value: string | null) => void;
  clearSavedDraft: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => {
      const goalPayload = toCreateProjectGoalsPayload(params.goals);
      return api.createProject({
        name: params.name.trim(),
        sourceType: params.sourceType,
        copyToWorkspace: params.copyToWorkspace,
        repositoryUrl:
          params.sourceType === "import_remote" && params.repositoryUrl.trim()
            ? params.repositoryUrl.trim()
            : undefined,
        basePath: params.basePath.trim() || undefined,
        githubSecretId: params.githubSecretId || undefined,
        description: params.description.trim() || undefined,
        goals: goalPayload.length > 0 ? goalPayload : undefined,
        startOnboarding: params.startOnboarding || undefined,
      });
    },
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      params.clearSavedDraft();
      params.toast.success(
        "Project created",
        "Your project is ready for planning.",
      );
      navigate(`/projects/${project.id}`);
    },
    onError: () => {
      params.setError("Failed to create project. Please try again.");
      params.toast.error(
        "Failed to create project",
        "Check required fields and try again.",
      );
    },
  });
}
