import type { RuntimeToolchainConfig } from "@nexus/core";
import { EventLedgerRecord } from "@/lib/api/event-ledger.types";
import { UpdateProjectRequest } from "@/lib/api/projects.types";

export interface SettingsFormState {
  name: string;
  description: string;
  repositoryUrl: string;
  basePath: string;
  githubSecretId: string;
  setName: (value: string) => void;
  setDescription: (value: string) => void;
  setRepositoryUrl: (value: string) => void;
  setBasePath: (value: string) => void;
  setGithubSecretId: (value: string) => void;
}

export interface GitActivityState {
  activity: EventLedgerRecord[];
  isLoading: boolean;
  isError: boolean;
}

export interface RepositoryWorkflowsState {
  enabled: boolean;
  overrides: Record<string, { enabled: boolean }>;
  isLoading: boolean;
  toggleEnabled: (value: boolean) => void;
  toggleOverride: (workflowId: string, enabled: boolean) => void;
}

export interface RuntimeToolchainsValue {
  value: RuntimeToolchainConfig;
}

export interface ProjectSettingsMutations {
  isSaving: boolean;
  isDeleting: boolean;
  feedback: string | null;
  setFeedback: (value: string | null) => void;
  saveProject: (request: UpdateProjectRequest) => void;
  saveRuntimeToolchains: (next: RuntimeToolchainConfig) => void;
  deleteDialogOpen: boolean;
  setDeleteDialogOpen: (open: boolean) => void;
  confirmDeleteProject: () => Promise<void>;
}
