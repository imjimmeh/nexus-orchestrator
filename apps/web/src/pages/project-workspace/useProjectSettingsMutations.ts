import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { RuntimeToolchainConfig } from "@nexus/core";
import { useDeleteProject } from "@/hooks/useProjects";
import { api } from "@/lib/api/client";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { UpdateProjectRequest } from "@/lib/api/projects.types";
import type { ProjectSettingsMutations } from "./SettingsTab.hooks.types";

export function useProjectSettingsMutations(
  projectId: string,
): ProjectSettingsMutations {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleteProject = useDeleteProject();
  const [feedback, setFeedback] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const updateProject = useMutation({
    mutationFn: (data: UpdateProjectRequest) =>
      api.updateProject(projectId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["projects", projectId] });
      setFeedback("Project settings updated.");
    },
    onError: (error) => {
      setFeedback(
        getApiErrorMessage(error, "Failed to update project settings."),
      );
    },
  });

  const saveProject = (request: UpdateProjectRequest) => {
    setFeedback(null);
    updateProject.mutate(request);
  };

  const saveRuntimeToolchains = (next: RuntimeToolchainConfig) => {
    setFeedback(null);
    updateProject.mutate({
      runtime_toolchains: next.toolchains.length ? next : null,
    });
  };

  const confirmDeleteProject = async (): Promise<void> => {
    try {
      await deleteProject.mutateAsync(projectId);
      setDeleteDialogOpen(false);
      navigate("/projects");
    } catch (error) {
      setFeedback(
        getApiErrorMessage(
          error,
          "Failed to delete project and associated records.",
        ),
      );
    }
  };

  return {
    isSaving: updateProject.isPending,
    isDeleting: deleteProject.isPending,
    feedback,
    setFeedback,
    saveProject,
    saveRuntimeToolchains,
    deleteDialogOpen,
    setDeleteDialogOpen,
    confirmDeleteProject,
  };
}
