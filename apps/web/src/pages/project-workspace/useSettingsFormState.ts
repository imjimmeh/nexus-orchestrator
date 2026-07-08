import { useEffect, useState } from "react";
import { Project } from "@/lib/api/projects.types";
import type { SettingsFormState } from "./SettingsTab.hooks.types";

export function useSettingsFormState(
  project: Project | undefined,
): SettingsFormState {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repositoryUrl, setRepositoryUrl] = useState("");
  const [basePath, setBasePath] = useState("");
  const [githubSecretId, setGithubSecretId] = useState("");

  useEffect(() => {
    if (!project) {
      return;
    }

    setName(project.name);
    setDescription(project.description ?? "");
    setRepositoryUrl(project.repositoryUrl ?? "");
    setBasePath(project.basePath ?? "");
    setGithubSecretId(project.githubSecretId ?? "");
  }, [project]);

  return {
    name,
    description,
    repositoryUrl,
    basePath,
    githubSecretId,
    setName,
    setDescription,
    setRepositoryUrl,
    setBasePath,
    setGithubSecretId,
  };
}
