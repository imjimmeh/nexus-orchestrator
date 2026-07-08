import type { ApiClient } from "./client";
import type { ApiClientProjectMethods } from "./client.projects.types";
import type {
  KanbanSetting,
  SystemSetting,
  TelegramSettings,
  UpdateTelegramSettingsRequest,
} from "./settings.types";
import type {
  InitializeSetupResponse,
  SetupStatus,
} from "./setup.types";

type ProjectSettingsApiMethods = Pick<
  ApiClientProjectMethods,
  | "getSetupStatus"
  | "initializeSetup"
  | "getKanbanSettings"
  | "updateKanbanSetting"
  | "getSystemSettings"
  | "getTelegramSettings"
  | "updateTelegramSettings"
  | "updateSystemSetting"
  | "getProjectRepositoryWorkflowSettings"
  | "updateProjectRepositoryWorkflowSettings"
>;

export const projectSettingsApiMethods: ProjectSettingsApiMethods = {
  async getSetupStatus(this: ApiClient) {
    return this.get<SetupStatus>("/setup/status");
  },

  async initializeSetup(this: ApiClient, data) {
    return this.post<InitializeSetupResponse>("/setup/initialize", data);
  },

  async getKanbanSettings(this: ApiClient) {
    return this.get<KanbanSetting[]>("/kanban-settings");
  },

  async updateKanbanSetting(this: ApiClient, key, value, description) {
    return this.put<KanbanSetting>(`/kanban-settings/${key}`, {
      value,
      description,
    });
  },

  async getSystemSettings(this: ApiClient) {
    return this.get<SystemSetting[]>("/system-settings");
  },

  async getTelegramSettings(this: ApiClient) {
    return this.get<TelegramSettings>("/system-settings/telegram");
  },

  async updateTelegramSettings(
    this: ApiClient,
    data: UpdateTelegramSettingsRequest,
  ) {
    return this.put<TelegramSettings>("/system-settings/telegram", data);
  },

  async updateSystemSetting(this: ApiClient, key, value, description) {
    return this.put<SystemSetting>(`/system-settings/${key}`, {
      value,
      description,
    });
  },

  async getProjectRepositoryWorkflowSettings(
    this: ApiClient,
    projectId: string,
  ) {
    return this.get<{
      enabled: boolean;
      overrides: Record<string, { enabled: boolean }>;
    }>(`/projects/${projectId}/repository-workflows/settings`);
  },

  async updateProjectRepositoryWorkflowSettings(
    this: ApiClient,
    projectId: string,
    data,
  ) {
    return this.patch<{
      enabled: boolean;
      overrides: Record<string, { enabled: boolean }>;
    }>(`/projects/${projectId}/repository-workflows/settings`, data);
  },
};
